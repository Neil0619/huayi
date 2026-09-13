import {
  acceptsStructuredTeaching,
  extensionQueryEventReadSchema,
  extensionQueryGenerationReadSchema,
  projectQueryEventForLegacy,
  projectQueryGenerationForLegacy,
  type ExtensionQueryEventRead,
  type ExtensionQueryGenerationRead,
} from "@huayi/cloud-contracts";

export function createExtensionQueryReadView(accept: string | undefined) {
  const nativeJson = acceptsStructuredTeaching(accept, "json");
  const nativeSse = acceptsStructuredTeaching(accept, "eventStream");
  return {
    generation: (value: ExtensionQueryGenerationRead) =>
      nativeJson
        ? extensionQueryGenerationReadSchema.parse(value)
        : projectQueryGenerationForLegacy(value),
    event: (value: ExtensionQueryEventRead) =>
      nativeSse ? extensionQueryEventReadSchema.parse(value) : projectQueryEventForLegacy(value),
  };
}
