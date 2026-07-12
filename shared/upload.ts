/**
 * shared/upload.ts — helpers for the `interceptor upload` file-attach verb.
 */

const EXT_MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  heic: "image/heic",
  heif: "image/heif",
  bmp: "image/bmp",
  tiff: "image/tiff",
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
  html: "text/html",
  json: "application/json",
  xml: "application/xml",
  zip: "application/zip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
}

/** Infer a MIME type from a file name's extension. Defaults to octet-stream. */
export function inferMime(fileName: string): string {
  const dot = fileName.lastIndexOf(".")
  if (dot < 0 || dot === fileName.length - 1) return "application/octet-stream"
  const ext = fileName.slice(dot + 1).toLowerCase()
  return EXT_MIME[ext] || "application/octet-stream"
}

/** Basename of a path, handling both / and \ separators. */
export function baseName(path: string): string {
  const parts = path.split(/[/\\]/)
  return parts[parts.length - 1] || "file"
}
