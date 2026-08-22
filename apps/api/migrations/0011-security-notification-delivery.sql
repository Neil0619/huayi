ALTER TABLE security_notification_outbox
  ADD COLUMN IF NOT EXISTS delivery_deadline_at timestamptz;

UPDATE security_notification_outbox
SET delivery_deadline_at = created_at + interval '23 hours'
WHERE delivery_deadline_at IS NULL;

ALTER TABLE security_notification_outbox
  ALTER COLUMN delivery_deadline_at SET NOT NULL,
  DROP CONSTRAINT IF EXISTS security_notification_outbox_status_check,
  DROP CONSTRAINT IF EXISTS security_notification_outbox_delivery_deadline_check;

ALTER TABLE security_notification_outbox
  ADD CONSTRAINT security_notification_outbox_status_check
    CHECK (status IN ('pending','sending','sent','failed','dead-letter')),
  ADD CONSTRAINT security_notification_outbox_delivery_deadline_check
    CHECK (delivery_deadline_at = created_at + interval '23 hours');

DROP FUNCTION IF EXISTS claim_security_notification(text,timestamptz,timestamptz);

CREATE FUNCTION claim_security_notification(
  new_lease_hash text,
  new_lease_expires_at timestamptz,
  claim_time timestamptz
) RETURNS TABLE(
  outcome text,
  notification_id uuid,
  email text,
  attempt_count integer,
  delivery_deadline_at timestamptz,
  deadline_exceeded_count integer,
  maximum_attempts_exceeded_count integer
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  deadline_count integer := 0;
  attempts_count integer := 0;
BEGIN
  IF new_lease_expires_at <= claim_time
    OR new_lease_expires_at > claim_time + interval '120 seconds'
  THEN RAISE EXCEPTION 'invalid notification lease'; END IF;

  WITH candidates AS (
    SELECT notifications.id
    FROM public.security_notification_outbox AS notifications
    WHERE notifications.delivery_deadline_at <= claim_time AND (
      notifications.status='pending'
      OR (notifications.status='sending' AND notifications.lease_expires_at<=claim_time)
    )
    ORDER BY notifications.delivery_deadline_at,notifications.created_at,notifications.id
    FOR UPDATE SKIP LOCKED LIMIT 100
  )
  UPDATE public.security_notification_outbox AS notifications SET
    status='failed',lease_hash=NULL,lease_expires_at=NULL
  FROM candidates WHERE notifications.id=candidates.id;
  GET DIAGNOSTICS deadline_count = ROW_COUNT;

  WITH candidates AS (
    SELECT notifications.id
    FROM public.security_notification_outbox AS notifications
    WHERE notifications.delivery_deadline_at > claim_time AND (
      notifications.status='pending'
      OR (notifications.status='sending' AND notifications.lease_expires_at<=claim_time)
    )
      AND notifications.attempt_count >= 8
    ORDER BY notifications.available_at,notifications.created_at,notifications.id
    FOR UPDATE SKIP LOCKED LIMIT (100-deadline_count)
  )
  UPDATE public.security_notification_outbox AS notifications SET
    status='dead-letter',lease_hash=NULL,lease_expires_at=NULL
  FROM candidates WHERE notifications.id=candidates.id;
  GET DIAGNOSTICS attempts_count = ROW_COUNT;

  IF deadline_count + attempts_count > 0 THEN
    RETURN QUERY SELECT
      'terminalized'::text,NULL::uuid,NULL::text,NULL::integer,NULL::timestamptz,
      deadline_count,attempts_count;
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidate AS (
    SELECT notifications.id,profiles.email
    FROM public.security_notification_outbox AS notifications
    JOIN public.user_profiles AS profiles ON profiles.user_id=notifications.owner_user_id
    WHERE profiles.status IN ('active','disabled')
      AND notifications.delivery_deadline_at > claim_time
      AND notifications.attempt_count < 8 AND (
        (notifications.status='pending' AND notifications.available_at<=claim_time)
        OR (notifications.status='sending' AND notifications.lease_expires_at<=claim_time)
      )
    ORDER BY notifications.available_at,notifications.created_at,notifications.id
    FOR UPDATE OF notifications SKIP LOCKED LIMIT 1
  )
  UPDATE public.security_notification_outbox AS notifications SET
    status='sending',attempt_count=notifications.attempt_count+1,
    lease_hash=new_lease_hash,lease_expires_at=new_lease_expires_at
  FROM candidate WHERE notifications.id=candidate.id
  RETURNING
    'delivery'::text,notifications.id,candidate.email,notifications.attempt_count,
    notifications.delivery_deadline_at,0::integer,0::integer;
END;
$$;

CREATE OR REPLACE FUNCTION retry_security_notification(
  selected_notification_id uuid,
  presented_lease_hash text,
  retry_available_at timestamptz,
  failed_at timestamptz
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE saved boolean;
BEGIN
  UPDATE public.security_notification_outbox AS notifications SET
    status=CASE
      WHEN notifications.delivery_deadline_at<=failed_at THEN 'failed'
      WHEN notifications.attempt_count>=8 THEN 'dead-letter'
      ELSE 'pending'
    END,
    available_at=CASE
      WHEN notifications.delivery_deadline_at<=failed_at OR notifications.attempt_count>=8
        THEN notifications.available_at
      ELSE LEAST(retry_available_at,notifications.delivery_deadline_at)
    END,
    lease_hash=NULL,lease_expires_at=NULL
  WHERE notifications.id=selected_notification_id AND notifications.status='sending'
    AND notifications.lease_hash=presented_lease_hash
    AND notifications.lease_expires_at>failed_at
    AND (
      notifications.delivery_deadline_at<=failed_at OR notifications.attempt_count>=8
      OR retry_available_at>failed_at
    )
  RETURNING true INTO saved;
  RETURN COALESCE(saved,false);
END;
$$;

REVOKE ALL ON FUNCTION claim_security_notification(text,timestamptz,timestamptz)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION retry_security_notification(uuid,text,timestamptz,timestamptz)
  FROM PUBLIC, huayi_business;
GRANT EXECUTE ON FUNCTION claim_security_notification(text,timestamptz,timestamptz)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION retry_security_notification(uuid,text,timestamptz,timestamptz)
  TO huayi_context_setter;
