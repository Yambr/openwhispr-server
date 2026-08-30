// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Body limit for the batch endpoints the desktop fills.
 *
 * The desktop pushes rows in fixed chunks of 50 (SyncService BATCH_SIZE) and a
 * synced note carries its `content`, `enhanced_content` and `transcript`. A
 * handful of meeting transcripts clears Fastify's 1 MiB default on its own, so
 * the client got "Request body is too large", treated the chunk as failed and
 * retried the same oversized chunk forever. Nothing on the client side can
 * split it: the batch size is a constant in a build we do not control.
 *
 * Raised ON THE BATCH ROUTES ONLY. They are the only endpoints that aggregate
 * rows, they already carry the tightest rate limit (5/min), and a global raise
 * would hand every other endpoint the same multi-megabyte buffer for nothing.
 *
 * 32 MiB is a judgment call, stated plainly: it covers 50 notes averaging
 * ~600 KB with room to spare, and sits under the ingress `proxy-body-size:
 * 100m`. It does NOT fund the theoretical schema maximum (50 × TRANSCRIPT_MAX
 * = 250 MB); a body that large is a 100-hour meeting, and funding it would mean
 * buffering a quarter-gigabyte per request. If a real batch ever exceeds this,
 * the answer is a smaller transcript cap, not an unbounded buffer.
 */
export const BATCH_BODY_LIMIT_BYTES = 32 * 1024 * 1024;
