BEGIN;

CREATE OR REPLACE FUNCTION public.analysis_reservation_amount(
  account_user_id uuid, request_id uuid, lease_token text, reservation_id uuid
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE amount bigint;
BEGIN
  SELECT reservations.reserved_micro_usd INTO amount
  FROM public.analysis_requests requests
  JOIN public.quota_reservations reservations
    ON reservations.id=requests.reservation_id AND reservations.request_id=requests.id
  WHERE requests.id=analysis_reservation_amount.request_id
    AND requests.owner_user_id=account_user_id
    AND requests.state='running'
    AND requests.lease_token=analysis_reservation_amount.lease_token
    AND requests.lease_expires_at>now()
    AND requests.reservation_id=analysis_reservation_amount.reservation_id
    AND reservations.user_id=account_user_id
    AND reservations.owner_user_id=account_user_id
    AND reservations.status='active'
  FOR UPDATE OF requests,reservations;
  IF amount IS NULL OR amount<=0 THEN RAISE EXCEPTION 'analysis reservation unavailable'; END IF;
  RETURN amount;
END;
$$;

REVOKE ALL ON FUNCTION public.analysis_reservation_amount(uuid, uuid, text, uuid)
  FROM PUBLIC, huayi_business;
GRANT EXECUTE ON FUNCTION public.analysis_reservation_amount(uuid, uuid, text, uuid)
  TO huayi_context_setter;

COMMIT;
