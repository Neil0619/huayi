interface ClearableCloudData {
  clear(): Promise<void>;
}

export async function clearCloudAccountData(...resources: ClearableCloudData[]): Promise<void> {
  await Promise.all(resources.map((resource) => resource.clear()));
}
