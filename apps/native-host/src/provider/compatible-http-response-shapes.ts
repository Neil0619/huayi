import { z } from "zod";

const MAXIMUM_IDENTIFIER_LENGTH = 512;
const MAXIMUM_MODEL_TEXT_LENGTH = 1024 * 1024;

const boundedTextSchema = z.string().max(MAXIMUM_MODEL_TEXT_LENGTH);
const finiteNumberSchema = z.number().finite();
const metadataIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const compatibleIdentifierSchema = z.string().min(1).max(MAXIMUM_IDENTIFIER_LENGTH);

export const compatibleOutputTextPartSchema = z.strictObject({
  annotations: z.tuple([]),
  logprobs: z.tuple([]).optional(),
  text: boundedTextSchema,
  type: z.literal("output_text"),
});

export const compatibleReasoningItemSchema = z.union([
  z.strictObject({
    id: compatibleIdentifierSchema,
    summary: z.tuple([]),
    type: z.literal("reasoning"),
  }),
  z.strictObject({
    content: z.tuple([]),
    encrypted_content: boundedTextSchema.min(1),
    id: compatibleIdentifierSchema,
    internal_chat_message_metadata_passthrough: z
      .strictObject({ turn_id: compatibleIdentifierSchema })
      .optional(),
    metadata: z.strictObject({ turn_id: compatibleIdentifierSchema }).optional(),
    summary: z.tuple([]),
    type: z.literal("reasoning"),
  }),
]);

export const compatibleAssistantAddedItemSchema = z.strictObject({
  content: z.tuple([]),
  id: compatibleIdentifierSchema,
  internal_chat_message_metadata_passthrough: z
    .strictObject({ turn_id: compatibleIdentifierSchema })
    .optional(),
  metadata: z.strictObject({ turn_id: compatibleIdentifierSchema }).optional(),
  phase: compatibleIdentifierSchema.optional(),
  role: z.literal("assistant"),
  status: z.literal("in_progress"),
  type: z.literal("message"),
});

export const compatibleAssistantDoneItemSchema = z.strictObject({
  content: z.tuple([compatibleOutputTextPartSchema]),
  id: compatibleIdentifierSchema,
  internal_chat_message_metadata_passthrough: z
    .strictObject({ turn_id: compatibleIdentifierSchema })
    .optional(),
  metadata: z.strictObject({ turn_id: compatibleIdentifierSchema }).optional(),
  phase: compatibleIdentifierSchema.optional(),
  role: z.literal("assistant"),
  status: z.literal("completed"),
  type: z.literal("message"),
});

const minimalInProgressResponseSchema = z.strictObject({
  error: z.null(),
  id: compatibleIdentifierSchema,
  incomplete_details: z.null(),
  output: z.tuple([]),
  status: z.literal("in_progress"),
});

const minimalCompletedResponseSchema = z.strictObject({
  error: z.null(),
  id: compatibleIdentifierSchema,
  incomplete_details: z.null(),
  output: z.tuple([compatibleAssistantDoneItemSchema]),
  status: z.literal("completed"),
});

type JsonValue = boolean | number | string | null | JsonValue[] | { [key: string]: JsonValue };

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const responseTextConfigurationSchema = z.strictObject({
  format: z.strictObject({
    description: z.null(),
    name: compatibleIdentifierSchema,
    schema: z.record(z.string(), jsonValueSchema),
    strict: z.literal(true),
    type: z.literal("json_schema"),
  }),
  verbosity: compatibleIdentifierSchema,
});

const responseReasoningConfigurationSchema = z.strictObject({
  context: boundedTextSchema,
  effort: z.enum(["low", "none"]),
  mode: compatibleIdentifierSchema,
  summary: z.null(),
});

const responseToolUsageSchema = z.strictObject({
  image_gen: z.strictObject({
    input_tokens: metadataIntegerSchema,
    input_tokens_details: z.strictObject({
      image_tokens: metadataIntegerSchema,
      text_tokens: metadataIntegerSchema,
    }),
    output_tokens: metadataIntegerSchema,
    output_tokens_details: z.strictObject({
      image_tokens: metadataIntegerSchema,
      text_tokens: metadataIntegerSchema,
    }),
    total_tokens: metadataIntegerSchema,
  }),
  web_search: z.strictObject({ num_requests: metadataIntegerSchema }),
});

const responseUsageSchema = z.strictObject({
  input_tokens: metadataIntegerSchema,
  input_tokens_details: z.strictObject({
    cache_write_tokens: metadataIntegerSchema,
    cached_tokens: metadataIntegerSchema,
  }),
  output_tokens: metadataIntegerSchema,
  output_tokens_details: z.strictObject({ reasoning_tokens: metadataIntegerSchema }),
  total_tokens: metadataIntegerSchema,
});

const fullResponseFields = {
  background: z.literal(false),
  created_at: metadataIntegerSchema,
  error: z.null(),
  frequency_penalty: finiteNumberSchema,
  id: compatibleIdentifierSchema,
  incomplete_details: z.null(),
  instructions: boundedTextSchema,
  max_output_tokens: z.null(),
  max_tool_calls: z.null(),
  metadata: z.strictObject({}),
  model: z.enum(["gpt-5.4", "gpt-5.4-mini", "gpt-5.6-luna"]),
  moderation: z.null(),
  object: z.literal("response"),
  parallel_tool_calls: z.boolean(),
  presence_penalty: finiteNumberSchema,
  previous_response_id: z.null(),
  prompt_cache_key: boundedTextSchema.min(1),
  prompt_cache_retention: compatibleIdentifierSchema,
  reasoning: responseReasoningConfigurationSchema,
  safety_identifier: compatibleIdentifierSchema,
  service_tier: compatibleIdentifierSchema,
  store: z.literal(false),
  temperature: finiteNumberSchema,
  text: responseTextConfigurationSchema,
  tool_choice: z.literal("auto"),
  tool_usage: responseToolUsageSchema,
  tools: z.tuple([]),
  top_logprobs: metadataIntegerSchema,
  top_p: finiteNumberSchema,
  truncation: z.literal("disabled"),
  user: z.null(),
} as const;

const gatewayCompletedMessageSchema = z.strictObject({
  content: z.tuple([z.strictObject({ text: boundedTextSchema, type: z.literal("output_text") })]),
  role: z.literal("assistant"),
  type: z.literal("message"),
});

const fullInProgressResponseSchema = z.strictObject({
  ...fullResponseFields,
  completed_at: z.null(),
  output: z.tuple([]),
  status: z.literal("in_progress"),
  usage: z.null(),
});

const fullCompletedResponseSchema = z.strictObject({
  ...fullResponseFields,
  completed_at: metadataIntegerSchema,
  output: z.union([
    z.tuple([gatewayCompletedMessageSchema]),
    z.tuple([compatibleReasoningItemSchema, compatibleAssistantDoneItemSchema]),
  ]),
  status: z.literal("completed"),
  usage: responseUsageSchema,
});

export const compatibleInProgressResponseSchema = z.union([
  minimalInProgressResponseSchema,
  fullInProgressResponseSchema,
]);

export const compatibleCompletedResponseSchema = z.union([
  minimalCompletedResponseSchema,
  fullCompletedResponseSchema,
]);
