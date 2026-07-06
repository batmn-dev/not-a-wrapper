import { setCsrfCookie } from "@/lib/csrf"
import { NextResponse } from "next/server"

export async function GET() {
  await setCsrfCookie()
  return NextResponse.json({ ok: true })
}
