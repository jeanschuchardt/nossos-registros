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
  sessionUrl: string;
  uploadName: string;
}
