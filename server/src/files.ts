/** A file from the school platform as the board serves it: Vklass's own files need the family's login, so the board fetches them. */
export interface BoardFile {
  name: string;
  url: string;
}

/** Vklass addresses go through the board's file route; other links open as they are. */
export function schoolFileUrl(url: string): string {
  return /^https:\/\/[a-z0-9.-]*vklass\.se\//i.test(url) ? `api/school/file?u=${encodeURIComponent(url)}` : url;
}

export function boardFiles(files: { name: string; url: string }[] | undefined): BoardFile[] | undefined {
  return files?.length ? files.map((f) => ({ name: f.name, url: schoolFileUrl(f.url) })) : undefined;
}
