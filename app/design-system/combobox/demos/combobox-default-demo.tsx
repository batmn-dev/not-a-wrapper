"use client"

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"

const frameworks = ["Next.js", "SvelteKit", "Nuxt", "Remix", "Astro", "Vite"]

export function ComboboxDefaultDemo() {
  return (
    <Combobox items={frameworks}>
      <ComboboxInput placeholder="Search frameworks" className="w-64" />
      <ComboboxContent>
        <ComboboxEmpty>No frameworks found.</ComboboxEmpty>
        <ComboboxList>
          {(framework: string) => (
            <ComboboxItem key={framework} value={framework}>
              {framework}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
