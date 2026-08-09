"use client"

import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "@/components/ui/combobox"
import { Fragment } from "react"

const tags = ["Docs", "Design", "Engineering", "Research", "Marketing"]

export function ComboboxChipsDemo() {
  const anchor = useComboboxAnchor()

  return (
    <Combobox multiple items={tags} defaultValue={["Docs"]}>
      <ComboboxChips ref={anchor} className="w-72">
        <ComboboxValue>
          {(value: string[]) => (
            <Fragment>
              {value.map((tag) => (
                <ComboboxChip key={tag} aria-label={tag}>
                  {tag}
                </ComboboxChip>
              ))}
              <ComboboxChipsInput
                placeholder={value.length > 0 ? "" : "Add tags"}
              />
            </Fragment>
          )}
        </ComboboxValue>
      </ComboboxChips>
      <ComboboxContent anchor={anchor}>
        <ComboboxEmpty>No tags found.</ComboboxEmpty>
        <ComboboxList>
          {(tag: string) => (
            <ComboboxItem key={tag} value={tag}>
              {tag}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
