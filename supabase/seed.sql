BEGIN;

INSERT INTO public.user_profiles (
  user_id, owner_user_id, email, status, timezone, daily_goal
) VALUES (
  '00000000-0000-4000-8000-000000000047',
  '00000000-0000-4000-8000-000000000047',
  'local-acceptance-operator@seen-said.localhost',
  'active',
  'Asia/Shanghai',
  1
)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.admin_roles (user_id, role)
VALUES ('00000000-0000-4000-8000-000000000047', 'operator')
ON CONFLICT (user_id) DO UPDATE SET role = 'operator';

DO $$
BEGIN
  PERFORM public.ensure_current_default_quota(
    '00000000-0000-4000-8000-000000000047',
    now()
  );
END;
$$;

COMMIT;
