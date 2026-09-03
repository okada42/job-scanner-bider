import { DEFAULT_PAGE_SIZE, sameJson } from "./jobs";

export const initialState = {
  error: "",
  scanNotes: {},
  scanners: null,
  jobs: [],
  jobsTotal: 0,
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  current: null,
  active: [],
  queued: [],
  bider: null,
  updating: false,
  loaded: false,
  reportingJobId: null,
};

export function reducer(state, action) {
  switch (action.type) {
    case "error":
      return state.error === action.error ? state : { ...state, error: action.error };
    case "updating":
      return state.updating === action.updating ? state : { ...state, updating: action.updating };
    case "jobs": {
      const sameJobs = sameJson(state.jobs, action.jobs);
      const sameTotal = state.jobsTotal === action.total;
      if (sameJobs && sameTotal) {
        if (!state.updating && state.loaded) return state;
        return { ...state, updating: false, loaded: true };
      }
      return {
        ...state,
        jobs: action.jobs,
        jobsTotal: action.total,
        updating: false,
        loaded: true,
      };
    }
    case "biderQueue": {
      const active = action.active || (action.current ? [action.current] : []);
      const sameCurrent = sameJson(state.current, action.current);
      const sameQueued = sameJson(state.queued, action.queued);
      const sameActive = sameJson(state.active, active);
      if (sameCurrent && sameQueued && sameActive) return state;
      return { ...state, current: action.current, queued: action.queued, active };
    }
    case "scanners":
      if (sameJson(state.scanners, action.scanners)) return state;
      return { ...state, scanners: action.scanners };
    case "settings":
      if (sameJson(state.bider, action.bider)) return state;
      return { ...state, bider: action.bider };
    case "page":
      return state.page === action.page ? state : { ...state, page: action.page };
    case "pageSize":
      if (state.pageSize === action.pageSize) return state;
      return { ...state, pageSize: action.pageSize, page: 1 };
    case "scanNote":
      return { ...state, scanNotes: { ...state.scanNotes, [action.id]: action.note } };
    case "reporting":
      return state.reportingJobId === action.id ? state : { ...state, reportingJobId: action.id };
    default:
      return state;
  }
}
