import {
  hostedAcceptanceApplicationRole,
  sqlLiteral,
  sqlTextArray,
} from "./acceptance-hosted-foundation.mjs";

const hostedProductRoleMemberships = Object.freeze([
  Object.freeze({
    grantedRole: "huayi_runtime",
    memberRole: hostedAcceptanceApplicationRole,
  }),
  Object.freeze({
    grantedRole: "huayi_business",
    memberRole: "huayi_runtime",
  }),
  Object.freeze({
    grantedRole: "huayi_context_setter",
    memberRole: "huayi_runtime",
  }),
]);

const hostedFixedRoles = Object.freeze([
  hostedAcceptanceApplicationRole,
  "huayi_runtime",
  "huayi_business",
  "huayi_context_setter",
]);

export function renderHostedRoleMembershipContractSql() {
  const fixedRoles = sqlTextArray(hostedFixedRoles);
  const requiredProductMemberships = hostedProductRoleMemberships
    .map(({ grantedRole, memberRole }) => `(${sqlLiteral(memberRole)}, ${sqlLiteral(grantedRole)})`)
    .join(",\n        ");

  return `(WITH incident_memberships AS (
    SELECT member_role.rolname AS member_role,
           granted_role.rolname AS granted_role,
           memberships.grantor,
           memberships.admin_option,
           memberships.inherit_option,
           memberships.set_option
    FROM pg_auth_members memberships
    JOIN pg_roles member_role ON member_role.oid = memberships.member
    JOIN pg_roles granted_role ON granted_role.oid = memberships.roleid
    WHERE member_role.rolname = ANY(${fixedRoles})
       OR granted_role.rolname = ANY(${fixedRoles})
  ), required_product_memberships(member_role, granted_role) AS (
    VALUES
        ${requiredProductMemberships}
  )
  SELECT NOT EXISTS (
    SELECT 1
    FROM required_product_memberships required_membership
    LEFT JOIN incident_memberships matching_memberships
      ON matching_memberships.member_role = required_membership.member_role
     AND matching_memberships.granted_role = required_membership.granted_role
    GROUP BY required_membership.member_role, required_membership.granted_role
    HAVING count(matching_memberships.grantor) <> 1
  ) AND NOT EXISTS (
    SELECT 1
    FROM incident_memberships membership
    WHERE NOT (
      (
        (membership.member_role, membership.granted_role) IN (
          ${requiredProductMemberships}
        )
        AND membership.admin_option IS FALSE
        AND membership.inherit_option IS FALSE
        AND membership.set_option IS TRUE
      ) OR (
        membership.member_role = 'postgres'
        AND membership.granted_role = ANY(${fixedRoles})
        AND membership.admin_option IS TRUE
        AND membership.inherit_option IS FALSE
        AND membership.set_option IS FALSE
      )
    )
  ))`;
}
