async (page) => {
  const base = "http://127.0.0.1:4179/index.html"
  const outDir = "/tmp/naw-activity-visual"

  const cases = [
    {
      name: "1024-light",
      width: 1024,
      height: 768,
      mode: "desktop",
      theme: "light",
    },
    {
      name: "1024-dark",
      width: 1024,
      height: 768,
      mode: "desktop",
      theme: "dark",
    },
    {
      name: "768-light",
      width: 768,
      height: 768,
      mode: "sheet",
      theme: "light",
    },
    {
      name: "768-dark",
      width: 768,
      height: 768,
      mode: "sheet",
      theme: "dark",
    },
    {
      name: "375-light",
      width: 375,
      height: 812,
      mode: "sheet",
      theme: "light",
    },
    {
      name: "375-dark",
      width: 375,
      height: 812,
      mode: "sheet",
      theme: "dark",
    },
    {
      name: "768-light-long",
      width: 768,
      height: 768,
      mode: "sheet",
      theme: "light",
      long: true,
    },
  ]

  const evidence = []
  for (const c of cases) {
    await page.setViewportSize({ width: c.width, height: c.height })
    await page.goto(
      `${base}?mode=${c.mode}&theme=${c.theme}${c.long ? "&long=1" : ""}`,
      { waitUntil: "networkidle" }
    )
    await page.waitForSelector(
      c.mode === "desktop"
        ? "[data-slot=activity-panel-dock] section"
        : "[data-slot=sheet-content]"
    )
    await page.waitForTimeout(400)

    const screenshot = `${outDir}/${c.name}.png`
    await page.screenshot({ path: screenshot, fullPage: false })

    const data = await page.evaluate((currentCase) => {
      function pickStyle(el, props) {
        if (!el) return null
        const s = getComputedStyle(el)
        const out = {}
        for (const prop of props) out[prop] = s.getPropertyValue(prop)
        return out
      }

      function rectOf(el) {
        if (!el) return null
        const r = el.getBoundingClientRect()
        return {
          x: Math.round(r.x * 100) / 100,
          y: Math.round(r.y * 100) / 100,
          width: Math.round(r.width * 100) / 100,
          height: Math.round(r.height * 100) / 100,
          top: Math.round(r.top * 100) / 100,
          right: Math.round(r.right * 100) / 100,
          bottom: Math.round(r.bottom * 100) / 100,
          left: Math.round(r.left * 100) / 100,
        }
      }

      const pageHeader = document.querySelector("[data-qa=page-header]")
      const dock = document.querySelector("[data-slot=activity-panel-dock]")
      const dockPanel = document.querySelector(
        "[data-slot=activity-panel-dock] section"
      )
      const sheet = document.querySelector("[data-slot=sheet-content]")
      const panel = dockPanel || sheet
      const sheetHeader = sheet?.querySelector("header") ?? null
      const dockHeader = dockPanel?.querySelector(":scope > div") ?? null
      const header = sheetHeader || dockHeader
      const close = header?.querySelector("[aria-label=Close]") ?? null
      const overlay = document.querySelector("[data-slot=sheet-overlay]")
      const handle = sheet?.querySelector(":scope > div[aria-hidden]") ?? null
      const sheetRegion =
        sheet?.querySelector("[data-slot=scroll-area][role=region]") ?? null
      const scrollArea =
        sheetRegion || panel?.querySelector("[data-slot=scroll-area]") || null
      const viewport =
        scrollArea?.querySelector("[data-slot=scroll-area-viewport]") ?? null
      const markerIcons = Array.from(
        document.querySelectorAll("[data-last] [data-slot=icon]")
      ).map((el) => ({
        rect: rectOf(el),
        slot: getComputedStyle(el).getPropertyValue("--icon-slot-size"),
        glyph: getComputedStyle(el).getPropertyValue("--icon-glyph-size"),
      }))
      const connector = document.querySelector(
        "[data-last=false] > div:first-child > div:nth-child(2)"
      )
      const spacer = document.querySelector(
        "[data-slot=activity-panel-dock] section [data-slot=scroll-area-viewport] > div[aria-hidden]"
      )
      const labelledBy =
        sheet?.getAttribute("aria-labelledby") ??
        dockPanel?.getAttribute("aria-labelledby")
      const titleText = labelledBy
        ? (document.getElementById(labelledBy)?.textContent ?? null)
        : null

      return {
        ...currentCase,
        titleText,
        pageHeader: {
          rect: rectOf(pageHeader),
          style: pickStyle(pageHeader, [
            "height",
            "padding",
            "box-shadow",
            "background-color",
          ]),
        },
        dock: {
          rect: rectOf(dock),
          style: pickStyle(dock, [
            "width",
            "transition-duration",
            "transition-property",
            "border-left-width",
            "border-left-color",
          ]),
        },
        panel: {
          rect: rectOf(panel),
          style: pickStyle(panel, [
            "display",
            "grid-template-rows",
            "height",
            "max-height",
            "overflow",
            "border-radius",
            "box-shadow",
            "background-color",
            "padding-bottom",
          ]),
        },
        header: {
          rect: rectOf(header),
          style: pickStyle(header, [
            "display",
            "grid-template-columns",
            "min-height",
            "height",
            "padding-top",
            "padding-right",
            "padding-bottom",
            "padding-left",
            "border-bottom-width",
          ]),
        },
        close: {
          rect: rectOf(close),
          style: pickStyle(close, [
            "display",
            "width",
            "height",
            "border-radius",
            "padding",
            "margin-inline-end",
          ]),
        },
        overlay: {
          rect: rectOf(overlay),
          style: pickStyle(overlay, [
            "background-color",
            "backdrop-filter",
            "transition-duration",
            "transition-property",
          ]),
        },
        handle: {
          rect: rectOf(handle),
          style: pickStyle(handle, [
            "display",
            "width",
            "height",
            "margin-top",
            "background-color",
            "border-radius",
          ]),
        },
        scrollArea: {
          rect: rectOf(scrollArea),
          style: pickStyle(scrollArea, ["min-height", "height", "overflow"]),
          metrics: viewport
            ? {
                clientHeight: viewport.clientHeight,
                scrollHeight: viewport.scrollHeight,
                canScroll: viewport.scrollHeight > viewport.clientHeight,
              }
            : null,
        },
        markerIcons,
        connector: {
          rect: rectOf(connector),
          style: pickStyle(connector, ["width", "background-color"]),
        },
        spacer: {
          rect: rectOf(spacer),
          style: pickStyle(spacer, ["height", "scroll-margin-bottom"]),
        },
        screenshot: `${currentCase.name}.png`,
      }
    }, c)

    evidence.push(data)
  }

  return evidence
}
