import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AdminAuditEvent,
  CreatedInvitationResponse,
  InvitationResource,
} from "@huayi/cloud-contracts";

import type { WebAdminOperationsApi } from "./admin-operations-api.js";

export function AdminSecondaryPanels({
  api,
  csrfToken,
}: {
  readonly api: WebAdminOperationsApi;
  readonly csrfToken: string;
}) {
  const [audit, setAudit] = useState<AdminAuditEvent[]>([]);
  const [auditCursor, setAuditCursor] = useState<string | null>(null);
  const [auditError, setAuditError] = useState("");
  const [invitation, setInvitation] = useState<CreatedInvitationResponse | null>(null);
  const [invitations, setInvitations] = useState<InvitationResource[]>([]);
  const [invitationCursor, setInvitationCursor] = useState<string | null>(null);
  const [invitationError, setInvitationError] = useState("");
  const [message, setMessage] = useState("");
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const invitationGeneration = useRef(0);
  const auditGeneration = useRef(0);

  const loadInvitations = useCallback(
    async (cursor?: string, append = false) => {
      const current = ++invitationGeneration.current;
      try {
        const response = await api.listInvitations(cursor);
        if (current !== invitationGeneration.current) return false;
        setInvitations((existing) =>
          append
            ? [
                ...existing,
                ...response.items.filter(
                  (item) => !existing.some((present) => present.id === item.id),
                ),
              ]
            : response.items,
        );
        setInvitationCursor(response.nextCursor);
        setInvitationError("");
        return true;
      } catch {
        if (current !== invitationGeneration.current) return false;
        setInvitationError(append ? "下一页邀请载入失败，已保留当前列表。" : "邀请列表载入失败。");
        return false;
      }
    },
    [api],
  );

  const loadAudit = useCallback(
    async (cursor?: string, append = false) => {
      const current = ++auditGeneration.current;
      try {
        const response = await api.listAuditEvents(undefined, cursor);
        if (current !== auditGeneration.current) return;
        setAudit((existing) =>
          append
            ? [
                ...existing,
                ...response.items.filter(
                  (item) => !existing.some((present) => present.id === item.id),
                ),
              ]
            : response.items,
        );
        setAuditCursor(response.nextCursor);
        setAuditError("");
      } catch {
        if (current !== auditGeneration.current) return;
        setAuditError(append ? "下一页审计载入失败，已保留当前列表。" : "审计列表载入失败。");
      }
    },
    [api],
  );

  useEffect(() => {
    void loadInvitations();
    void loadAudit();
    return () => {
      invitationGeneration.current += 1;
      auditGeneration.current += 1;
    };
  }, [loadAudit, loadInvitations]);
  useEffect(() => confirmRef.current?.focus(), [revokeId]);

  const create = async () => {
    setMessage("");
    try {
      const created = await api.createInvitation(72, csrfToken);
      setInvitation(created);
      setInvitations((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      const refreshed = await loadInvitations();
      setMessage(
        refreshed
          ? "邀请已创建。链接仅在当前响应中显示，请立即安全传递。"
          : "邀请已创建，但列表刷新失败；一次性链接仍可立即使用。",
      );
    } catch {
      setMessage("邀请未创建，请重新认证后重试。");
    }
  };

  const revoke = async (id: string) => {
    try {
      await api.revokeInvitation(id, csrfToken);
      setInvitations((current) =>
        current.map((item) =>
          item.id === id ? { ...item, revokedAt: new Date().toISOString() } : item,
        ),
      );
      setRevokeId(null);
      setMessage((await loadInvitations()) ? "邀请已撤销。" : "邀请已撤销，但列表刷新失败。");
    } catch {
      setInvitationError("邀请未撤销，已保留当前列表。");
    }
  };

  return (
    <section className="admin-split">
      <section className="admin-section" aria-labelledby="invitations-title">
        <div className="admin-section-heading">
          <h2 id="invitations-title">邀请</h2>
          <button onClick={() => void create()} type="button">
            创建邀请
          </button>
        </div>
        <p aria-live="polite" role="status">
          {message}
        </p>
        {invitation !== null && (
          <output className="admin-invitation-path">{invitation.invitationPath}</output>
        )}
        {invitationError !== "" && (
          <div className="alert" role="alert">
            <p>{invitationError}</p>
            <button onClick={() => void loadInvitations()} type="button">
              重试邀请列表
            </button>
          </div>
        )}
        <ul>
          {invitations.map((item) => (
            <li key={item.id}>
              <span>{item.id}</span>
              <time>{item.expiresAt}</time>
              {item.revokedAt === null && item.consumedAt === null && (
                <button onClick={() => setRevokeId(item.id)} type="button">
                  撤销
                </button>
              )}
              {revokeId === item.id && (
                <div className="admin-confirm" role="group" aria-label={`确认撤销邀请 ${item.id}`}>
                  <p>撤销后该邀请不能再领取，已领取账号不受影响。</p>
                  <button onClick={() => void revoke(item.id)} ref={confirmRef} type="button">
                    确认撤销邀请
                  </button>
                  <button onClick={() => setRevokeId(null)} type="button">
                    取消
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {invitations.length === 0 && invitationError === "" && <p>暂无邀请。</p>}
        {invitationCursor !== null && (
          <button onClick={() => void loadInvitations(invitationCursor, true)} type="button">
            载入更多邀请
          </button>
        )}
      </section>
      <section className="admin-section" aria-labelledby="audit-title">
        <div className="admin-section-heading">
          <h2 id="audit-title">无正文审计</h2>
        </div>
        {auditError !== "" && (
          <div className="alert" role="alert">
            <p>{auditError}</p>
            <button onClick={() => void loadAudit()} type="button">
              重试审计列表
            </button>
          </div>
        )}
        <ol>
          {audit.map((event) => (
            <li key={event.id}>
              <strong>{event.action}</strong>
              <span>{event.subjectId}</span>
              <time>{event.createdAt}</time>
            </li>
          ))}
        </ol>
        {audit.length === 0 && auditError === "" && <p>暂无审计事件。</p>}
        {auditCursor !== null && (
          <button onClick={() => void loadAudit(auditCursor, true)} type="button">
            载入更多审计
          </button>
        )}
      </section>
    </section>
  );
}
