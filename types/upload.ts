export type UploadStatus =
  | "queued"
  | "creating-session"
  | "uploading"
  | "retrying"
  | "completed"
  | "failed"
  | "cancelled";

export interface UploadEntry {
  id: string;
  file: File;
  previewUrl?: string;
  progress: number;
  uploadedBytes: number;
  status: UploadStatus;
  error?: string;
}

export interface InitiateUploadResponse {
  uploadId: string;
  sessionUrl?: string;
  uploadName?: string;
  completed?: boolean;
  awaitingConfirmation?: boolean;
}
