import type { ApiError } from "@huayi/cloud-contracts";

export type CloudFaultCode = ApiError["error"]["code"];

export class CloudFault extends Error {
  readonly code: CloudFaultCode;

  constructor(code: CloudFaultCode, message: string) {
    super(message);
    this.name = "CloudFault";
    this.code = code;
  }
}
