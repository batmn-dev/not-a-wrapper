"use client"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import {
  RiDeleteBinLine,
  RiExternalLinkLine,
  RiLoader4Line,
} from "@remixicon/react"
import type { ReactNode } from "react"
import { useProviderKeys, type ProviderKeyConfig } from "./use-provider-keys"

type TileContext = {
  selected: boolean
  hasKey: boolean
  onSelect: () => void
}

type ProviderKeyPanelProps<P extends ProviderKeyConfig> = {
  providers: P[]
  defaultProvider: string
  keyStatus: Record<string, boolean>
  noun: string
  header: ReactNode
  tilesClassName?: string
  tilesExtra?: ReactNode
  renderTile: (provider: P, ctx: TileContext) => ReactNode
  deleteDescription: (name: string) => ReactNode
  /**
   * Optional per-provider detail block rendered under the key form (e.g.
   * BYOK's routing preference + served-models summary). Receives the selected
   * provider id and whether a key is stored for it.
   */
  renderDetails?: (providerId: string, ctx: { hasKey: boolean }) => ReactNode
  onSaved?: (
    providerId: string,
    result: { isNewKey?: boolean }
  ) => void | Promise<void>
  onDeleted?: (providerId: string) => void | Promise<void>
}

/**
 * The shared provider-key panel: tiles (via the `renderTile` slot) over the
 * single key-input form and delete-confirmation dialog, driven by
 * `useProviderKeys`. Callers supply the provider list, the tile presentation,
 * copy, and any save/delete side-effects; everything else is shared.
 */
export function ProviderKeyPanel<P extends ProviderKeyConfig>({
  providers,
  defaultProvider,
  keyStatus,
  noun,
  header,
  tilesClassName,
  tilesExtra,
  renderTile,
  deleteDescription,
  renderDetails,
  onSaved,
  onDeleted,
}: ProviderKeyPanelProps<P>) {
  const keys = useProviderKeys({
    providers,
    defaultProvider,
    keyStatus,
    noun,
    onSaved,
    onDeleted,
  })

  const selected = keys.selectedConfig

  return (
    <div>
      {header}

      <div className={cn("mt-4", tilesClassName)}>
        {providers.map((provider) =>
          renderTile(provider, {
            selected: provider.id === keys.selectedProvider,
            hasKey: keys.hasKey(provider.id),
            onSelect: () => keys.select(provider.id),
          })
        )}
        {tilesExtra}
      </div>

      {selected != null && (
        <div className="mt-4">
          <div className="flex flex-col">
            <Label htmlFor={`${keys.selectedProvider}-key`} className="mb-3">
              {selected.name} API Key
            </Label>
            <Input
              id={`${keys.selectedProvider}-key`}
              type="password"
              placeholder={selected.placeholder}
              value={keys.inputValue}
              onChange={(e) => keys.setInputValue(e.target.value)}
              onFocus={keys.onInputFocus}
              disabled={keys.saving}
            />
            <div className="mt-0 flex justify-between pl-1">
              <a
                href={selected.getKeyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground mt-1 inline-flex items-center gap-1 text-xs hover:underline"
              >
                <Icon icon={RiExternalLinkLine} slotSize={12} />
                Get API key
              </a>
              <div className="flex gap-2">
                {keys.hasKey(keys.selectedProvider) && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    onClick={() => keys.requestDelete(keys.selectedProvider)}
                    disabled={keys.deleting || keys.saving}
                  >
                    <Icon
                      icon={RiDeleteBinLine}
                      slotSize={16}
                      className="mr-1"
                    />
                    Delete
                  </Button>
                )}
                <Button
                  onClick={keys.save}
                  type="button"
                  size="sm"
                  className="mt-2"
                  disabled={keys.saving || keys.deleting}
                >
                  {keys.saving ? (
                    <>
                      <Icon
                        icon={RiLoader4Line}
                        slotSize={16}
                        className="mr-2 animate-spin"
                      />
                      Saving
                    </>
                  ) : (
                    "Save"
                  )}
                </Button>
              </div>
            </div>
          </div>
          {renderDetails?.(keys.selectedProvider, {
            hasKey: keys.hasKey(keys.selectedProvider),
          })}
        </div>
      )}

      <AlertDialog
        open={keys.deleteDialogOpen}
        onOpenChange={keys.setDeleteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {noun}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteDescription(keys.nameOf(keys.providerToDelete))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={keys.confirmDelete}
              disabled={keys.deleting}
            >
              {keys.deleting ? (
                <Icon
                  icon={RiLoader4Line}
                  slotSize={16}
                  className="mr-2 animate-spin"
                />
              ) : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
