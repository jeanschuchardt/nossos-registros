export type UploadStatus =
  | "queued"
  | "creating-session"
  | "uploading"
  | "retrying"
  | "needs-file"
  | "completed"
  | "failed"
  | "cancelled";

export interface UploadEntry {
  id: string;
  file?: File;
  filename: string;
  size: number;
  mimeType: string;
  lastModified: number;
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
