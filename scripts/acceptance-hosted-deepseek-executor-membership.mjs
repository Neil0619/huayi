const executorRole = "huayi_hosted_acceptance_executor";
const creatorRole = "postgres";

export function renderHostedDeepseekExecutorMembershipContractSql() {
  return `(SELECT count(*) <= 1
    AND COALESCE(
      bool_and(
        granted_role.rolname = '${executorRole}'
        AND member_role.rolname = '${creatorRole}'
        AND membership.admin_option
        AND NOT membership.inherit_option
        AND NOT membership.set_option
      ),
      TRUE
    )
  FROM pg_auth_members membership
  JOIN pg_roles granted_role ON granted_role.oid = membership.roleid
  JOIN pg_roles member_role ON member_role.oid = membership.member
  WHERE granted_role.rolname = '${executorRole}'
     OR member_role.rolname = '${executorRole}')`;
}
