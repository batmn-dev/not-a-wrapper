---
name: convex-function
description: Create new Convex database functions with proper authentication and ownership patterns. Use when adding new database queries, mutations, or actions, or when asked to "add a Convex function" or "create database operation".
---

# Create Convex Database Function

Guide for creating secure Convex functions following project patterns.

## Prerequisites

- [ ] Understand if you need a query, mutation, or action
- [ ] Know which table(s) you're working with
- [ ] Understand ownership requirements

## Function Types

| Type | Use For | Can Modify DB | Can Call External APIs |
|------|---------|---------------|------------------------|
| `query` | Reading data | No | No |
| `mutation` | Writing data | Yes | No |
| `action` | External APIs, complex logic | Via mutations | Yes |

## Quick Reference

```typescript
// Location: convex/[feature].ts

// Query (read-only)
export const get = query({
  args: { id: v.id("table") },
  handler: async (ctx, args) => { ... }
})

// Mutation (writes)
export const create = mutation({
  args: { ... },
  handler: async (ctx, args) => { ... }
})

// Action (external calls)
export const process = action({
  args: { ... },
  handler: async (ctx, args) => { ... }
})
```

## Security Pattern (CRITICAL)

**All mutations modifying user data MUST follow this pattern:**

```typescript
export const update = mutation({
  args: { 
    chatId: v.id("chats"),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    // 1. AUTHENTICATE - Get user identity
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }
    
    // 2. LOOKUP USER - Get user record by WorkOS user ID
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", identity.subject))
      .unique()
    
    if (!user) {
      throw new Error("User not found")
    }
    
    // 3. VERIFY OWNERSHIP - Check resource belongs to user
    const chat = await ctx.db.get(args.chatId)
    if (!chat || chat.userId !== user._id) {
      throw new Error("Not authorized")
    }
    
    // 4. OPERATE - Now safe to modify
    await ctx.db.patch(args.chatId, { 
      title: args.title,
      updatedAt: Date.now(),
    })
    
    return { success: true }
  },
})
```

## Common Patterns

### Public Query (No Auth Required)

```typescript
// For public resources like shared chats
export const getPublic = query({
  args: { chatId: v.id("chats") },
  handler: async (ctx, args) => {
    const chat = await ctx.db.get(args.chatId)
    
    // Only return if explicitly public
    if (!chat || !chat.public) {
      return null
    }
    
    return chat
  },
})
```

### Authenticated Query

```typescript
export const getForCurrentUser = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return []
    
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", identity.subject))
      .unique()
    
    if (!user) return []
    
    return await ctx.db
      .query("chats")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect()
  },
})
```

### Create with Ownership

```typescript
export const create = mutation({
  args: {
    title: v.optional(v.string()),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")
    
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", identity.subject))
      .unique()
    
    if (!user) throw new Error("User not found")
    
    // Create with user ownership
    const chatId = await ctx.db.insert("chats", {
      userId: user._id,           // Link to user
      title: args.title,
      model: args.model,
      public: false,
      pinned: false,
      updatedAt: Date.now(),
    })
    
    return chatId
  },
})
```

### Delete with Cascade

```typescript
export const remove = mutation({
  args: { chatId: v.id("chats") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")
    
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", identity.subject))
      .unique()
    
    const chat = await ctx.db.get(args.chatId)
    if (!user || !chat || chat.userId !== user._id) {
      throw new Error("Not authorized")
    }
    
    // CASCADE DELETE
    // 1. Delete messages
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
      .collect()
    
    for (const msg of messages) {
      await ctx.db.delete(msg._id)
    }
    
    // 2. Delete attachments
    const attachments = await ctx.db
      .query("chatAttachments")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
      .collect()
    
    for (const att of attachments) {
      if (att.storageId) {
        await ctx.storage.delete(att.storageId)
      }
      await ctx.db.delete(att._id)
    }
    
    // 3. Delete chat
    await ctx.db.delete(args.chatId)
    
    return { success: true }
  },
})
```

## Validator Types

```typescript
import { v } from "convex/values"

// Primitives
v.string()
v.number()
v.boolean()
v.null()

// IDs (type-safe references)
v.id("chats")        // Id<"chats">
v.id("users")        // Id<"users">

// Optional
v.optional(v.string())

// Arrays
v.array(v.string())

// Unions
v.union(
  v.literal("user"),
  v.literal("assistant"),
  v.literal("system")
)

// Any (use sparingly)
v.any()

// Objects
v.object({
  name: v.string(),
  age: v.number(),
})
```

## Using Indexes

```typescript
// Always use indexes for filtered queries
// Check convex/schema.ts for available indexes

// Good: Uses index
const chats = await ctx.db
  .query("chats")
  .withIndex("by_user", (q) => q.eq("userId", user._id))
  .collect()

// Bad: Full table scan
const chats = await ctx.db
  .query("chats")
  .filter((q) => q.eq(q.field("userId"), user._id))
  .collect()
```

## Validation Checklist

- [ ] Auth check for mutations modifying user data
- [ ] Ownership verification before modifications
- [ ] Using indexes for queries (not filters)
- [ ] Proper validator types for arguments
- [ ] Cascade deletes for parent records
- [ ] `updatedAt` timestamp updated on modifications
- [ ] `bun run typecheck` passes

## Common Mistakes

1. **Missing auth check** - Security vulnerability
2. **Missing ownership check** - Users can modify others' data
3. **Using filter instead of index** - Slow queries
4. **Forgetting cascade deletes** - Orphaned data
5. **Not updating timestamps** - Sort order breaks
