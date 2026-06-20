/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as chatRuntime from "../chatRuntime.js";
import type * as chats from "../chats.js";
import type * as domain_message_branch_writes from "../domain/message_branch_writes.js";
import type * as domain_message_branches from "../domain/message_branches.js";
import type * as domain_message_contract from "../domain/message_contract.js";
import type * as domain_message_parts from "../domain/message_parts.js";
import type * as domain_message_visibility from "../domain/message_visibility.js";
import type * as feedback from "../feedback.js";
import type * as files from "../files.js";
import type * as http from "../http.js";
import type * as lib_auth from "../lib/auth.js";
import type * as mcpServers from "../mcpServers.js";
import type * as mcpToolApprovals from "../mcpToolApprovals.js";
import type * as mcpToolCallLog from "../mcpToolCallLog.js";
import type * as messages from "../messages.js";
import type * as projects from "../projects.js";
import type * as toolCallLog from "../toolCallLog.js";
import type * as toolLimits from "../toolLimits.js";
import type * as usage from "../usage.js";
import type * as userKeys from "../userKeys.js";
import type * as userPreferences from "../userPreferences.js";
import type * as userSync from "../userSync.js";
import type * as users from "../users.js";
import type * as workosAuth from "../workosAuth.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  chatRuntime: typeof chatRuntime;
  chats: typeof chats;
  "domain/message_branch_writes": typeof domain_message_branch_writes;
  "domain/message_branches": typeof domain_message_branches;
  "domain/message_contract": typeof domain_message_contract;
  "domain/message_parts": typeof domain_message_parts;
  "domain/message_visibility": typeof domain_message_visibility;
  feedback: typeof feedback;
  files: typeof files;
  http: typeof http;
  "lib/auth": typeof lib_auth;
  mcpServers: typeof mcpServers;
  mcpToolApprovals: typeof mcpToolApprovals;
  mcpToolCallLog: typeof mcpToolCallLog;
  messages: typeof messages;
  projects: typeof projects;
  toolCallLog: typeof toolCallLog;
  toolLimits: typeof toolLimits;
  usage: typeof usage;
  userKeys: typeof userKeys;
  userPreferences: typeof userPreferences;
  userSync: typeof userSync;
  users: typeof users;
  workosAuth: typeof workosAuth;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  workOSAuthKit: import("@convex-dev/workos-authkit/_generated/component.js").ComponentApi<"workOSAuthKit">;
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
};
