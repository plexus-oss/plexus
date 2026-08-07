"use client";

import { useState, useCallback, useRef } from "react";
import {
  Upload,
  X,
  File,
  FileText,
  Image,
  FileSpreadsheet,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface FileUploadProps {
  onUpload: (files: FileInfo[]) => void;
  accept?: string;
  maxSize?: number; // in MB
  maxFiles?: number;
}

export interface FileInfo {
  file: File;
  id: string;
  name: string;
  size: number;
  type: string;
  preview?: string;
}

const FILE_TYPES = {
  pdf: { icon: FileText, color: "text-red-500", bg: "bg-red-500/10" },
  image: { icon: Image, color: "text-blue-500", bg: "bg-blue-500/10" },
  spreadsheet: {
    icon: FileSpreadsheet,
    color: "text-green-500",
    bg: "bg-green-500/10",
  },
  default: { icon: File, color: "text-muted-foreground", bg: "bg-muted" },
};

function getFileType(mimeType: string): keyof typeof FILE_TYPES {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("image/")) return "image";
  if (
    mimeType.includes("spreadsheet") ||
    mimeType.includes("excel") ||
    mimeType === "text/csv"
  ) {
    return "spreadsheet";
  }
  return "default";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileUpload({
  onUpload,
  accept = "*",
  maxSize = 50,
  maxFiles = 10,
}: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<FileInfo[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const processFiles = useCallback(
    (files: FileList | File[]) => {
      const validFiles: FileInfo[] = [];

      for (const file of Array.from(files)) {
        // Check max size
        if (file.size > maxSize * 1024 * 1024) {
          console.warn(`File ${file.name} exceeds max size of ${maxSize}MB`);
          continue;
        }

        // Check max files
        if (selectedFiles.length + validFiles.length >= maxFiles) {
          console.warn(`Max ${maxFiles} files allowed`);
          break;
        }

        const fileInfo: FileInfo = {
          file,
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: file.name,
          size: file.size,
          type: file.type,
        };

        // Generate preview for images
        if (file.type.startsWith("image/")) {
          fileInfo.preview = URL.createObjectURL(file);
        }

        validFiles.push(fileInfo);
      }

      setSelectedFiles((prev) => [...prev, ...validFiles]);
    },
    [maxSize, maxFiles, selectedFiles.length],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      processFiles(e.dataTransfer.files);
    },
    [processFiles],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        processFiles(e.target.files);
      }
    },
    [processFiles],
  );

  const handleRemoveFile = useCallback((id: string) => {
    setSelectedFiles((prev) => {
      const file = prev.find((f) => f.id === id);
      if (file?.preview) {
        URL.revokeObjectURL(file.preview);
      }
      return prev.filter((f) => f.id !== id);
    });
  }, []);

  const handleUpload = useCallback(async () => {
    if (selectedFiles.length === 0) return;

    setIsUploading(true);
    try {
      onUpload(selectedFiles);
      setSelectedFiles([]);
    } finally {
      setIsUploading(false);
    }
  }, [selectedFiles, onUpload]);

  return (
    <div className="space-y-4">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-muted-foreground/50",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={accept}
          onChange={handleFileSelect}
          className="hidden"
        />
        <Upload
          className={cn(
            "h-8 w-8 mx-auto mb-3",
            isDragging ? "text-primary" : "text-muted-foreground",
          )}
        />
        <p className="text-sm font-medium mb-1">
          {isDragging ? "Drop files here" : "Click to upload or drag and drop"}
        </p>
        <p className="text-xs text-muted-foreground">
          Max {maxSize}MB per file, up to {maxFiles} files
        </p>
      </div>

      {selectedFiles.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              {selectedFiles.length} file{selectedFiles.length !== 1 ? "s" : ""}{" "}
              selected
            </span>
            <Button
              size="sm"
              onClick={handleUpload}
              disabled={isUploading}
              className="h-7 text-xs"
            >
              {isUploading ? (
                "Uploading..."
              ) : (
                <>
                  <Check className="h-3 w-3 mr-1" />
                  Upload All
                </>
              )}
            </Button>
          </div>

          <div className="space-y-2">
            {selectedFiles.map((fileInfo) => {
              const fileType = getFileType(fileInfo.type);
              const { icon: Icon, color, bg } = FILE_TYPES[fileType];

              return (
                <Card key={fileInfo.id} className="p-3 flex items-center gap-3">
                  <div className={cn("p-2 rounded-lg", bg)}>
                    <Icon className={cn("h-4 w-4", color)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {fileInfo.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(fileInfo.size)}
                    </p>
                  </div>
                  {fileInfo.preview && (
                    // eslint-disable-next-line @next/next/no-img-element -- blob: object URL from URL.createObjectURL, not optimizable by next/image
                    <img
                      src={fileInfo.preview}
                      alt={fileInfo.name}
                      className="h-10 w-10 rounded object-cover"
                    />
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveFile(fileInfo.id)}
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
