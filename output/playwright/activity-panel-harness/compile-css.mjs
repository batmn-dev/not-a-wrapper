import fs from "node:fs/promises"
import postcss from "postcss"
import tailwind from "@tailwindcss/postcss"

const repo = "/Users/andresgonzalez/Github/Projects/not-a-wrapper"
const inputPath = `${repo}/app/globals.css`
const outputPath = new URL("./app.css", import.meta.url)
const input = await fs.readFile(inputPath, "utf8")
const result = await postcss([tailwind]).process(input, {
  from: inputPath,
  to: outputPath,
})

await fs.writeFile(outputPath, result.css)
