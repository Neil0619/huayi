import { CloudFault } from "./cloud-fault.js";
export function miniProgramToken(authorization: string | undefined): string {
  const token = /^HuayiMiniProgram ([A-Za-z0-9_-]{43})$/u.exec(authorization ?? "")?.[1];
  if (!token) throw new CloudFault("forbidden", "A mini-program session is required.");
  return token;
}
