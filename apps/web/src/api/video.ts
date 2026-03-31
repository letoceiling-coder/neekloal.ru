import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import { useAuthStore } from "../stores/authStore";

export interface GenerateVideoInput {
  prompt: string;
  duration: number;
  fps: number;
  mode?: "text" | "image2video";
  imageUrl?: string;
}

export interface GenerateVideoResponse {
  jobId: string;
  status: "queued" | "processing" | "completed" | "failed";
  position: number | null;
  eta: number | null;
  mode: "text" | "image2video";
  width: number;
  height: number;
  fps: number;
  duration: number;
  frameCount: number;
  message?: string;
}

export interface VideoStatusResponse {
  jobId: string;
  id?: string;
  status: "queued" | "processing" | "completed" | "failed";
  position: number | null;
  eta: number | null;
  progress?: number;
  mode?: "text" | "image2video";
  prompt?: string;
  width?: number;
  height?: number;
  fps?: number;
  duration?: number;
  frameCount?: number;
  url?: string | null;
  previewUrl?: string | null;
  referenceUrl?: string | null;
  error?: string | null;
  createdAt?: string;
  completedAt?: string | null;
}

export interface VideoQueueResponse {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  avgTimeSec?: number;
  etaModelSecPerJob?: number;
}

const VIDEO_QUEUE_KEY = ["video-queue"] as const;
const videoStatusKey = (jobId: string) => ["video-status", jobId] as const;

export async function generateVideo(data: GenerateVideoInput) {
  return apiClient.post<GenerateVideoResponse>("/video/generate", data);
}

export async function getVideoStatus(id: string) {
  return apiClient.get<VideoStatusResponse>(`/video/status/${id}`);
}

export async function getVideoQueue() {
  return apiClient.get<VideoQueueResponse>("/video/queue");
}

export function useGenerateVideo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: generateVideo,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: VIDEO_QUEUE_KEY });
    },
  });
}

export function useVideoQueue() {
  const accessToken = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: VIDEO_QUEUE_KEY,
    queryFn: getVideoQueue,
    enabled: Boolean(accessToken),
    staleTime: 1_000,
  });
}

export function useVideoStatus(jobId: string | null) {
  const accessToken = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: videoStatusKey(jobId || "none"),
    queryFn: () => getVideoStatus(jobId || ""),
    enabled: Boolean(accessToken && jobId),
    staleTime: 1_000,
  });
}

