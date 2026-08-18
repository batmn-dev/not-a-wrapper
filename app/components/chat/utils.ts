export const addUTM = (url: string) => {
  try {
    const u = new URL(url)
    if (!["http:", "https:"].includes(u.protocol)) {
      return url
    }

    u.searchParams.set("utm_source", "not-a-wrapper.com")
    u.searchParams.set("utm_medium", "research")
    return u.toString()
  } catch {
    return url
  }
}

export const formatUrl = (url: string) => {
  try {
    return url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")
  } catch {
    return url
  }
}

export const getSiteName = (url: string) => {
  try {
    const urlObj = new URL(url)
    return urlObj.hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}
