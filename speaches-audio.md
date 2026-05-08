# Speaches Audio API (transcriptions / diarization / realtime)

Speaches master задеплоен на `aimodels.inner.alfaleasing.ru`
(контейнер `llm-speaches`, образ `speaches-local:master-cuda-12.6.3`,
порт 8014). Через nginx проксируется три аудио-роута, все доступны
наружу через LiteLLM proxy с проверкой ключа.

| Эндпоинт LiteLLM | Backend | Auth |
|---|---|---|
| `POST /v1/audio/transcriptions` | Whisper-large-v3-russian | virtual key (LiteLLM model) |
| `POST /v1/audio/diarization` | pyannote/speaker-diarization-community-1 | virtual key (LiteLLM pass-through) |
| `WSS /v1/realtime` | Speaches Realtime (OpenAI Realtime spec) | virtual key (LiteLLM realtime mode) |

Все три используют один upstream-ключ — `ALFALEASING_API_KEY`
(общий для всех `aimodels` моделей). LiteLLM подменяет `Authorization`
при форварде, клиенту это не видно.

Hosts:
- **Prod**: `https://llm-api.yc.alfaleasing.ru`
- **Dev**: `https://llm-api.k8s-dev.yc.alfaleasing.ru`

---

## 1. Транскрипции (Whisper)

### Модели

| Model name | Язык | Endpoint |
|---|---|---|
| `alfaleasing/whisper-large-v3-russian` | ru (default) | `/v1/audio/transcriptions` |
| `alfaleasing/whisper-large-v3-english` | en (alias к той же модели) | `/v1/audio/transcriptions` |
| `alfaleasing/canary-1b-v2` | multi-lang (Russian by default) | `/v1/canary/audio/transcriptions` |

### Пример

```bash
curl -X POST https://llm-api.yc.alfaleasing.ru/v1/audio/transcriptions \
  -H "Authorization: Bearer sk-YOUR-KEY" \
  -F file=@meeting.wav \
  -F model=alfaleasing/whisper-large-v3-russian
```

Ответ:
```json
{
  "text": "Продолжение следует.",
  "language": "ru",
  "duration": 2.0,
  "segments": [{"id": 1, "start": 0.0, "end": 2.0, "text": " Продолжение следует.", ...}]
}
```

Опционально — `extra_body.prompt` (биас-промпт по доменной лексике)
уже захардкожен в конфиге для русской модели. `language=en` для
английского алиаса захардкожен аналогично.

---

## 2. Диаризация (pyannote)

`POST /v1/audio/diarization` — определяет, **кто говорит когда**
(не _что_ говорит). Сегменты с привязкой к спикерам (`SPEAKER_00`,
`SPEAKER_01`, …).

Не нативный для LiteLLM эндпоинт — выставлен через
`pass_through_endpoints` ([.helm/templates/002-configmap.yaml](../../.helm/templates/002-configmap.yaml#L587-L600))
с `auth: true`. Виртуальный ключ LiteLLM проверяется, бюджет/лимиты по
ключам работают. **Учёт расходов LiteLLM по pass-through не ведёт** —
запросы попадают в spend logs только через guardrails post-call (ПДН-аудит)
и nginx access log.

### Модели

Передавать в form-поле `model`:

| `model=` | Описание |
|---|---|
| `pyannote/speaker-diarization-community-1` | Основная diarization-модель |
| `pyannote/wespeaker-voxceleb-resnet34-LM` | Speaker embedding (если нужно сравнивать голоса между файлами) |

### Пример

```bash
curl -X POST https://llm-api.yc.alfaleasing.ru/v1/audio/diarization \
  -H "Authorization: Bearer sk-YOUR-KEY" \
  -F file=@meeting.wav \
  -F model=pyannote/speaker-diarization-community-1
```

Ответ:
```json
{
  "duration": 2.0,
  "segments": [
    {"start": 0.031, "end": 0.048, "speaker": "SPEAKER_00"}
  ]
}
```

### Связка с транскрипцией

Speaches и LiteLLM не делают «diarization + transcription» в одном
запросе. Стандартный паттерн на клиенте:

1. `POST /v1/audio/diarization` → массив сегментов со спикерами
2. Для каждого сегмента (или весь файл) — `POST /v1/audio/transcriptions`
3. Сшить по таймстемпам

---

## 3. Realtime (WebSocket)

`WSS /v1/realtime?model=alfaleasing/speaches-realtime` — потоковая
транскрипция / разговорный режим через OpenAI Realtime API spec.
Speaches заявляет совместимость с этой спекой.

LiteLLM v1.82.0+ поддерживает `mode: realtime` — сам поднимает upstream
WS-соединение и пробрасывает события туда-обратно
([.helm/templates/002-configmap.yaml](../../.helm/templates/002-configmap.yaml#L1003-L1014)).
Ingress (`090-ingress.yaml`, 3600s read/send timeouts) пропускает
WebSocket Upgrade.

### Подключение

```python
import asyncio, websockets

async def main():
    url = "wss://llm-api.yc.alfaleasing.ru/v1/realtime?model=alfaleasing/speaches-realtime"
    headers = [("Authorization", "Bearer sk-YOUR-KEY")]
    async with websockets.connect(url, additional_headers=headers) as ws:
        # сразу прилетает session.created
        msg = await ws.recv()
        print(msg)
        # дальше — посылаем session.update / input_audio_buffer.append / ...

asyncio.run(main())
```

Первое событие после handshake:
```json
{
  "type": "session.created",
  "event_id": "event_...",
  "session": {
    "id": "sess_...",
    "input_audio_format": "pcm16",
    "input_audio_transcription": {"model": "Systran/faster-distil-whisper-small.en", "language": null},
    ...
  }
}
```

Параметры (`language`, `transcription_model`, …) задаются через `session.update`
event — см. [Speaches Realtime docs](https://speaches.ai/usage/realtime-api/).

---

## Auth и budget

Один обычный virtual key (`sk-...`) покрывает все три роута. Ограничение
по `models=[...]` whitelist у ключа применяется ко всем — для realtime
прописывайте `alfaleasing/speaches-realtime`, для diarization
поле `model` (pyannote/...) тоже валидируется. Самый простой случай —
выпустить ключ без `models` ограничения (тогда работают все).

Пример выпуска временного ключа для тестов:

```bash
curl -X POST https://llm-api.yc.alfaleasing.ru/key/generate \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"duration":"2h","max_budget":50,"key_alias":"audio-test"}'
```

## Известные баги (закрытые патчем)

- **multipart pass-through 500** — LiteLLM v1.82.3 ронял diarization
  с 500 text/plain до route handler из-за `custom_body: Optional[dict]`
  параметра в FastAPI signature и `not _parsed_body` гарда в multipart
  branch. Бэкпорт фикса из v1.83.7-stable
  ([PR BerriAI/litellm#25464](https://github.com/BerriAI/litellm/pull/25464)) —
  [patches/fix_passthrough_multipart.py](../../patches/fix_passthrough_multipart.py).
