import {
  STORE_MESSAGE_VERSION,
  parseStoreHandshakeEnvelope,
  type StoreHandshakeEnvelope,
  type StoreHandshakeResponse,
} from "@huayi/store-domain";

export function handleStoreMessage(
  message: unknown,
  extensionVersion: string,
): StoreHandshakeResponse | undefined {
  let envelope: StoreHandshakeEnvelope;
  try {
    envelope = parseStoreHandshakeEnvelope(message);
  } catch {
    return undefined;
  }
  if (envelope.messageVersion !== STORE_MESSAGE_VERSION) {
    return {
      compatible: false,
      expectedMessageVersion: STORE_MESSAGE_VERSION,
      receivedMessageVersion: envelope.messageVersion,
      requestId: envelope.requestId,
      type: "store/handshake-result",
    };
  }
  return {
    compatible: true,
    extensionVersion,
    messageVersion: STORE_MESSAGE_VERSION,
    requestId: envelope.requestId,
    type: "store/handshake-result",
  };
}
