import {
  STORE_MESSAGE_VERSION,
  parseStoreHandshakeResponse,
  type StoreHandshakeRequest,
  type StoreHandshakeResponse,
} from "@huayi/store-domain";

export type StoreMessageSender = (message: StoreHandshakeRequest) => Promise<unknown>;

export async function requestVersionHandshake(
  sendMessage: StoreMessageSender,
  requestId: string,
): Promise<StoreHandshakeResponse> {
  const response = await sendMessage({
    messageVersion: STORE_MESSAGE_VERSION,
    requestId,
    type: "store/handshake",
  });
  return parseStoreHandshakeResponse(response);
}
