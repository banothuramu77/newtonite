import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  getWorkItems,
  getWorkItem,
  createWorkItem,
  updateWorkItem,
  assignWorkItem,
  changeStatus,
  addComment,
  deleteComment,
  CreateWorkItemData,
  UpdateWorkItemData,
  AssignWorkItemData,
} from '../api/workItems';
import { WorkItem, WorkItemFilters, WorkItemStatus, PaginatedResponse } from '../types';

const WORK_ITEMS_KEY = 'workItems';
const WORK_ITEM_KEY = 'workItem';

function is409(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('409');
}

export function useWorkItems(filters: WorkItemFilters) {
  return useQuery({
    queryKey: [WORK_ITEMS_KEY, filters],
    queryFn: () => getWorkItems(filters),
  });
}

export function useWorkItem(id: string) {
  return useQuery({
    queryKey: [WORK_ITEM_KEY, id],
    queryFn: () => getWorkItem(id),
    refetchInterval: 30_000, // poll every 30 seconds
    enabled: !!id,
  });
}

export function useCreateWorkItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateWorkItemData) => createWorkItem(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [WORK_ITEMS_KEY] });
      toast.success('Work item created successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create work item');
    },
  });
}

export function useUpdateWorkItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateWorkItemData }) =>
      updateWorkItem(id, data),
    onMutate: async ({ id, data }) => {
      // Cancel any outgoing refetches for this item
      await queryClient.cancelQueries({ queryKey: [WORK_ITEM_KEY, id] });

      // Snapshot the previous value
      const previous = queryClient.getQueryData([WORK_ITEM_KEY, id]);

      // Optimistically update
      queryClient.setQueryData([WORK_ITEM_KEY, id], (old: unknown) => {
        if (!old || typeof old !== 'object') return old;
        const oldData = old as { workItem: WorkItem; activityLog: unknown[]; comments: unknown[] };
        return {
          ...oldData,
          workItem: { ...oldData.workItem, ...data },
        };
      });

      return { previous, id };
    },
    onError: (error: Error, _vars, context) => {
      // Revert optimistic update
      if (context?.previous && context.id) {
        queryClient.setQueryData([WORK_ITEM_KEY, context.id], context.previous);
      }
      if (is409(error)) {
        toast.error('Cannot save: item was modified by another user. Refresh the page.');
      } else {
        toast.error(error.message || 'Failed to update work item');
      }
    },
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: [WORK_ITEM_KEY, id] });
      queryClient.invalidateQueries({ queryKey: [WORK_ITEMS_KEY] });
      toast.success('Work item updated');
    },
  });
}

export function useAssignWorkItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: AssignWorkItemData }) =>
      assignWorkItem(id, data),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: [WORK_ITEM_KEY, id] });
      queryClient.invalidateQueries({ queryKey: [WORK_ITEMS_KEY] });
      toast.success('Assignment updated');
    },
    onError: (error: Error) => {
      if (is409(error)) {
        toast.error('Item modified by another user. Please refresh.');
      } else {
        toast.error(error.message || 'Failed to assign work item');
      }
    },
  });
}

export function useChangeStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      status,
      version,
    }: {
      id: string;
      status: WorkItemStatus;
      version: number;
    }) => changeStatus(id, status, version),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: [WORK_ITEM_KEY, id] });
      queryClient.invalidateQueries({ queryKey: [WORK_ITEMS_KEY] });
      toast.success('Status updated');
    },
    onError: (error: Error) => {
      if (is409(error)) {
        toast.error('Item modified by another user. Please refresh.');
      } else {
        toast.error(error.message || 'Failed to update status');
      }
    },
  });
}

export function useAddComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      addComment(id, content),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: [WORK_ITEM_KEY, id] });
      toast.success('Comment added');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to add comment');
    },
  });
}

export function useDeleteComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ workItemId, commentId }: { workItemId: string; commentId: string }) =>
      deleteComment(workItemId, commentId),
    onSuccess: (_data, { workItemId }) => {
      queryClient.invalidateQueries({ queryKey: [WORK_ITEM_KEY, workItemId] });
      toast.success('Comment deleted');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete comment');
    },
  });
}

export function useWorkItemsInvalidation() {
  const queryClient = useQueryClient();
  return {
    invalidateAll: () => {
      queryClient.invalidateQueries({ queryKey: [WORK_ITEMS_KEY] });
    },
    invalidateOne: (id: string) => {
      queryClient.invalidateQueries({ queryKey: [WORK_ITEM_KEY, id] });
    },
    prefetchWorkItems: (filters: WorkItemFilters) => {
      queryClient.prefetchQuery({
        queryKey: [WORK_ITEMS_KEY, filters],
        queryFn: () => getWorkItems(filters),
      });
    },
    updateWorkItemCache: (updater: (old: PaginatedResponse<WorkItem>) => PaginatedResponse<WorkItem>) => {
      queryClient.setQueriesData<PaginatedResponse<WorkItem>>(
        { queryKey: [WORK_ITEMS_KEY] },
        (old) => old ? updater(old) : old
      );
    },
  };
}
