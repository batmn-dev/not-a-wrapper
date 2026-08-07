import { designSystemComponents } from "@/app/design-system/_lib/catalog"
import { redirect } from "next/navigation"

export default function DesignSystemPage() {
  redirect(designSystemComponents[0].href)
}
