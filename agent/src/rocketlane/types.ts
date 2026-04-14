// Rocketlane REST API — TypeScript types
//
// These types are loose (most fields optional / unknown) because the PRD §9
// documents the shape we expect but the actual API may return additional or
// slightly different fields. The test-rl.ts script captures real response
// shapes in rl-api-contract.json; refine these types over time as needed.

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/** Shared fields on most entity responses */
export interface RlEntityBase {
  [k: string]: unknown;
}

// ---------- Projects ----------

export interface RlProjectOwner {
  emailId: string;
  [k: string]: unknown;
}

export interface RlProjectCustomer {
  companyName: string;
  [k: string]: unknown;
}

export interface CreateProjectArgs {
  projectName: string;
  owner: RlProjectOwner;
  customer: RlProjectCustomer;
  startDate?: string; // YYYY-MM-DD
  dueDate?: string;
  autoCreateCompany?: boolean;
  description?: string;
}

export interface RlProject extends RlEntityBase {
  projectId: number;
  projectName?: string;
}

// ---------- Phases ----------

export interface CreatePhaseArgs {
  phaseName: string;
  project: { projectId: number };
  startDate: string; // REQUIRED by Rocketlane
  dueDate: string; // REQUIRED by Rocketlane
  description?: string;
}

export interface RlPhase extends RlEntityBase {
  phaseId: number;
  phaseName?: string;
}

// ---------- Tasks ----------

export type RlTaskType = 'TASK' | 'MILESTONE';

export interface RlTaskStatus {
  /** 1 = To do, 2 = In progress, 3 = Completed */
  value: 1 | 2 | 3;
}

export interface CreateTaskArgs {
  taskName: string;
  project: { projectId: number };
  phase?: { phaseId: number };
  parent?: { taskId: number };
  type?: RlTaskType;
  startDate?: string;
  dueDate?: string;
  effortInMinutes?: number;
  progress?: number; // 0-100
  status?: RlTaskStatus;
  taskDescription?: string;
  assignees?: { members: Array<{ emailId: string }> };
  atRisk?: boolean;
}

export interface RlTask extends RlEntityBase {
  taskId: number;
  taskName?: string;
  type?: RlTaskType;
  parent?: { taskId: number };
  phase?: { phaseId: number };
  startDate?: string;
  dueDate?: string;
}

// ---------- Dependencies ----------

export interface AddDependenciesArgs {
  /** List of task IDs this task depends on (i.e. must finish before this task can start) */
  dependencies: Array<{ taskId: number }>;
}

// ---------- Responses ----------

export interface RlListProjectsResponse {
  data?: RlProject[];
  pagination?: { hasMore?: boolean; nextPageToken?: string };
  [k: string]: unknown;
}

export interface RlListCompaniesResponse {
  data?: Array<{
    companyId: number;
    companyName: string;
    companyType?: 'CUSTOMER' | 'VENDOR';
    createdAt?: number;
    updatedAt?: number;
    [k: string]: unknown;
  }>;
  pagination?: { pageSize?: number; hasMore?: boolean; totalRecordCount?: number };
  [k: string]: unknown;
}

export type RlUserType = 'TEAM_MEMBER' | 'CUSTOMER';

export interface RlUser extends RlEntityBase {
  userId: number;
  /** Note: Rocketlane returns `email` here, not `emailId` like other endpoints */
  email?: string;
  firstName?: string;
  lastName?: string;
  type?: RlUserType;
  status?: 'ACTIVE' | 'INVITED' | 'INACTIVE' | string;
}

export interface RlListUsersResponse {
  data?: RlUser[];
  pagination?: { pageSize?: number; hasMore?: boolean; totalRecordCount?: number };
  [k: string]: unknown;
}
