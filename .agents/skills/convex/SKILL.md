---
name: convex
description: Route Convex questions for this repository about backend functions, schemas, data access, React and Next.js clients, WorkOS AuthKit, scheduling, storage, components and agents, testing, deployment, CLI, MCP, limits, and production health to prioritized current official documentation while checking repository-local package versions.
---

# Convex documentation router

Use this skill as a routing index, not an implementation playbook. Official docs
may describe APIs newer than this repository has installed; before applying
examples or API guidance, verify declared versions in `package.json`, exact
resolutions in `bun.lock`, and available APIs in the installed package types.
Follow `AGENTS.md`, and read `docs/convex-access.md` before inspecting any live
Convex deployment.

1. If you need help with Convex-wide correctness, security, scalability, or TypeScript conventions, go here: [Best Practices](https://docs.convex.dev/understanding/best-practices) and [TypeScript](https://docs.convex.dev/understanding/best-practices/typescript).
2. If you need help choosing or defining public backend functions, go here: [Queries](https://docs.convex.dev/functions/query-functions), [Mutations](https://docs.convex.dev/functions/mutation-functions), and [Actions](https://docs.convex.dev/functions/actions).
3. If you need help with internal functions, runtime boundaries, or argument and return validators, go here: [Internal Functions](https://docs.convex.dev/functions/internal-functions), [Runtimes](https://docs.convex.dev/functions/runtimes), and [Argument and Return Value Validation](https://docs.convex.dev/functions/validation).
4. If you need help with schemas, validators, supported values, or relational document IDs, go here: [Schemas](https://docs.convex.dev/database/schemas), [Data Types](https://docs.convex.dev/database/types), and [Document IDs](https://docs.convex.dev/database/document-ids).
5. If you need help reading or writing documents or selecting efficient indexes, go here: [Reading Data](https://docs.convex.dev/database/reading-data), [Writing Data](https://docs.convex.dev/database/writing-data), and [Indexes](https://docs.convex.dev/database/reading-data/indexes).
6. If you need help with cursor-based backend or React pagination, go here: [Paginated Queries](https://docs.convex.dev/database/pagination).
7. If you need help reasoning about transaction atomicity, optimistic concurrency, retries, or write conflicts, go here: [OCC and Atomicity](https://docs.convex.dev/database/advanced/occ).
8. If you need help with React hooks, reactive subscriptions, or realtime consistency, go here: [Convex React](https://docs.convex.dev/client/react/overview) and [Realtime](https://docs.convex.dev/realtime).
9. If you need help adding client-side optimistic behavior to Convex mutations, go here: [Optimistic Updates](https://docs.convex.dev/client/react/optimistic-updates).
10. If you need help integrating Convex with the Next.js App Router or server-side data fetching, go here: [Next.js](https://docs.convex.dev/client/nextjs/app-router) and [Next.js Server Rendering](https://docs.convex.dev/client/nextjs/app-router/server-rendering).
11. If you need help with WorkOS AuthKit integration, authentication state, or authorization inside functions, go here: [Convex & WorkOS AuthKit](https://docs.convex.dev/auth/authkit) and [Auth in Functions](https://docs.convex.dev/auth/functions-auth).
12. If you need help distinguishing expected application errors from system failures or confirming `ConvexError`, go here: [Error Handling](https://docs.convex.dev/functions/error-handling) and [`ConvexError` API reference](https://docs.convex.dev/api/classes/values.ConvexError).
13. If you need help with one-off scheduled work, `ctx.scheduler`, or recurring jobs in `crons.ts`, go here: [Scheduled Functions](https://docs.convex.dev/scheduling/scheduled-functions) and [Cron Jobs](https://docs.convex.dev/scheduling/cron-jobs).
14. If you need help uploading, serving, inspecting, or deleting Convex-managed files, go here: [File Storage](https://docs.convex.dev/file-storage/overview) and [Uploading and Storing Files](https://docs.convex.dev/file-storage/upload-files).
15. If you need help registering or evaluating Convex components, especially `@convex-dev/agent`, go here: [Using Components](https://docs.convex.dev/components/using) and [AI Agents](https://docs.convex.dev/agents/overview).
16. If you need help choosing or implementing Convex backend tests, go here: [Testing](https://docs.convex.dev/testing/overview) and [`convex-test`](https://docs.convex.dev/testing/convex-test).
17. If you need help with project or deployment configuration, environment variables, Vercel builds, or multiple deployments, go here: [Project Configuration](https://docs.convex.dev/production/project-configuration), [Environment Variables](https://docs.convex.dev/production/environment-variables), [Using Convex with Vercel](https://docs.convex.dev/production/hosting/vercel), and [Working with Multiple Deployments](https://docs.convex.dev/production/multiple-deployments).
18. If you need help with Convex CLI workflows, logs, data inspection, deployment targeting, or MCP tooling, go here: [CLI](https://docs.convex.dev/cli/overview) and [Convex MCP Server](https://docs.convex.dev/ai/convex-mcp-server).
19. If you need help diagnosing query performance, platform limits, or production health, go here: [Introduction to Indexes and Query Performance](https://docs.convex.dev/database/reading-data/indexes/indexes-and-query-perf), [Limits](https://docs.convex.dev/production/state/limits), and [Deployment Health](https://docs.convex.dev/dashboard/deployments/health).
20. If the topic is not covered by this prioritized index, go here: [Official Convex documentation catalog](https://docs.convex.dev/llms.txt).
