"use client"

import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { useForm } from "react-hook-form"

export function FormDemo() {
  const form = useForm({ defaultValues: { username: "" } })

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(() => form.reset())}
        className="flex w-72 flex-col gap-5"
        noValidate
      >
        <FormField
          control={form.control}
          name="username"
          rules={{ required: "Username is required." }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Username</FormLabel>
              <FormControl>
                <Input placeholder="ada" {...field} />
              </FormControl>
              <FormDescription>Your public handle.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="self-start">
          Submit
        </Button>
      </form>
    </Form>
  )
}
