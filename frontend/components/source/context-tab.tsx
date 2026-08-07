"use client";

/**
 * Context Tab Component
 *
 * Displays and manages context attachments (files, links, notes) for a source.
 */

import { useState } from "react";
import { useSourceContext } from "@/hooks/use-source-context";
import { FileUpload, type FileInfo } from "@/components/file-upload";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DeleteButton } from "@/components/ui/delete-button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import {
  FileText,
  Link as LinkIcon,
  StickyNote,
  Download,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import type { SourceContext } from "@/lib/db/types";
import { SectionHeader } from "../ui/section-header";

interface ContextTabProps {
  sourceId: string;
}

export function ContextTab({ sourceId }: ContextTabProps) {
  const {
    files,
    links,
    notes,
    isLoading,
    uploadFile,
    createLink,
    createNote,
    deleteContext,
    getDownloadUrl,
  } = useSourceContext(sourceId);

  const [showAddLinkDialog, setShowAddLinkDialog] = useState(false);
  const [showAddNoteDialog, setShowAddNoteDialog] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Form state
  const [newLink, setNewLink] = useState({
    name: "",
    url: "",
    description: "",
  });
  const [newNote, setNewNote] = useState({
    name: "",
    content: "",
    description: "",
  });

  const handleFileUpload = async (fileInfos: FileInfo[]) => {
    setIsUploading(true);
    try {
      for (const fileInfo of fileInfos) {
        await uploadFile(fileInfo.file);
      }
    } finally {
      setIsUploading(false);
    }
  };

  const handleAddLink = async () => {
    if (!newLink.name || !newLink.url) return;

    await createLink({
      name: newLink.name,
      link_url: newLink.url,
      description: newLink.description || undefined,
    });

    setShowAddLinkDialog(false);
    setNewLink({ name: "", url: "", description: "" });
  };

  const handleAddNote = async () => {
    if (!newNote.name || !newNote.content) return;

    await createNote({
      name: newNote.name,
      content: newNote.content,
      description: newNote.description || undefined,
    });

    setShowAddNoteDialog(false);
    setNewNote({ name: "", content: "", description: "" });
  };

  const handleDownload = async (item: SourceContext) => {
    const url = await getDownloadUrl(item.id);
    if (url) {
      window.open(url, "_blank");
    }
  };

  const handleDelete = async (item: SourceContext) => {
    await deleteContext(item.id);
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <section>
        <SectionHeader className="pb-4">Files</SectionHeader>
        <FileUpload
          onUpload={handleFileUpload}
          maxSize={50}
          maxFiles={10}
          accept="*"
        />

        {isUploading && (
          <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" />
            Uploading...
          </div>
        )}

        {files.length > 0 && (
          <div className="mt-4 space-y-2">
            {files.map((file) => (
              <ContextItemCard
                key={file.id}
                item={file}
                icon={<FileText className="h-4 w-4 text-blue-500" />}
                onDelete={() => handleDelete(file)}
                onAction={() => handleDownload(file)}
                actionIcon={<Download className="h-4 w-4" />}
                actionLabel="Download"
                subtitle={formatFileSize(file.file_size || 0)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Links Section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <SectionHeader>Links</SectionHeader>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowAddLinkDialog(true)}
          >
            Add Link
          </Button>
        </div>

        {links.length > 0 ? (
          <div className="space-y-2">
            {links.map((link) => (
              <ContextItemCard
                key={link.id}
                item={link}
                icon={<LinkIcon className="h-4 w-4 text-purple-500" />}
                onDelete={() => handleDelete(link)}
                onAction={() => window.open(link.link_url!, "_blank")}
                actionIcon={<ExternalLink className="h-4 w-4" />}
                actionLabel="Open"
                subtitle={truncateUrl(link.link_url || "")}
              />
            ))}
          </div>
        ) : (
          <Card className="p-4 text-center text-sm text-muted-foreground">
            No links added yet
          </Card>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <SectionHeader>Notes</SectionHeader>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowAddNoteDialog(true)}
          >
            Add Note
          </Button>
        </div>

        {notes.length > 0 ? (
          <div className="space-y-2">
            {notes.map((note) => (
              <NoteCard
                key={note.id}
                item={note}
                onDelete={() => handleDelete(note)}
              />
            ))}
          </div>
        ) : (
          <Card className="p-4 text-center text-sm text-muted-foreground">
            No notes added yet
          </Card>
        )}
      </section>

      {/* Add Link Dialog */}
      <Dialog open={showAddLinkDialog} onOpenChange={setShowAddLinkDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Link</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-sm font-medium">Name</Label>
              <Input
                placeholder="e.g., Manufacturer documentation"
                value={newLink.name}
                onChange={(e) =>
                  setNewLink({ ...newLink, name: e.target.value })
                }
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm font-medium">URL</Label>
              <Input
                placeholder="https://..."
                value={newLink.url}
                onChange={(e) =>
                  setNewLink({ ...newLink, url: e.target.value })
                }
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm font-medium">
                Description (optional)
              </Label>
              <Textarea
                placeholder="Brief description of this link..."
                value={newLink.description}
                onChange={(e) =>
                  setNewLink({ ...newLink, description: e.target.value })
                }
                className="mt-1"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowAddLinkDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddLink}
              disabled={!newLink.name || !newLink.url}
            >
              Add Link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Note Dialog */}
      <Dialog open={showAddNoteDialog} onOpenChange={setShowAddNoteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Note</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-sm font-medium">Title</Label>
              <Input
                placeholder="e.g., Calibration procedure"
                value={newNote.name}
                onChange={(e) =>
                  setNewNote({ ...newNote, name: e.target.value })
                }
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm font-medium">Content</Label>
              <Textarea
                placeholder="Write your note here..."
                value={newNote.content}
                onChange={(e) =>
                  setNewNote({ ...newNote, content: e.target.value })
                }
                className="mt-1"
                rows={6}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowAddNoteDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddNote}
              disabled={!newNote.name || !newNote.content}
            >
              Add Note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// =============================================================================
// Helper Components
// =============================================================================

interface ContextItemCardProps {
  item: SourceContext;
  icon: React.ReactNode;
  onDelete: () => void;
  onAction?: () => void;
  actionIcon?: React.ReactNode;
  actionLabel?: string;
  subtitle?: string;
}

function ContextItemCard({
  item,
  icon,
  onDelete,
  onAction,
  actionIcon,
  actionLabel,
  subtitle,
}: ContextItemCardProps) {
  return (
    <Card className="p-3 flex items-center gap-3">
      <div className="p-2 rounded-lg bg-muted">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{item.name}</p>
        <p className="text-xs text-muted-foreground">
          {subtitle && <span>{subtitle} &middot; </span>}
          {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
        </p>
        {item.description && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
            {item.description}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1">
        {onAction && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onAction}
            className="h-8 w-8 p-0"
            title={actionLabel}
          >
            {actionIcon}
          </Button>
        )}
        <DeleteButton
          entityName={item.name}
          onConfirm={onDelete}
        />
      </div>
    </Card>
  );
}

interface NoteCardProps {
  item: SourceContext;
  onDelete: () => void;
}

function NoteCard({ item, onDelete }: NoteCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isLong = (item.content?.length || 0) > 200;

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="p-2 rounded-lg bg-muted shrink-0">
            <StickyNote className="h-4 w-4 text-yellow-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">{item.name}</p>
            <p
              className={cn(
                "text-sm text-muted-foreground mt-1 whitespace-pre-wrap",
                !expanded && isLong && "line-clamp-3",
              )}
            >
              {item.content}
            </p>
            {isLong && (
              <Button
                variant="link"
                size="sm"
                onClick={() => setExpanded(!expanded)}
                className="p-0 h-auto text-xs"
              >
                {expanded ? (
                  <>
                    Show less <ChevronUp className="h-3 w-3 ml-1" />
                  </>
                ) : (
                  <>
                    Show more <ChevronDown className="h-3 w-3 ml-1" />
                  </>
                )}
              </Button>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              {formatDistanceToNow(new Date(item.created_at), {
                addSuffix: true,
              })}
            </p>
          </div>
        </div>
        <DeleteButton
          entityName={item.name}
          onConfirm={onDelete}
          className="shrink-0"
        />
      </div>
    </Card>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function truncateUrl(url: string, maxLength = 40): string {
  try {
    const parsed = new URL(url);
    const display = parsed.hostname + parsed.pathname;
    if (display.length <= maxLength) return display;
    return display.substring(0, maxLength - 3) + "...";
  } catch {
    if (url.length <= maxLength) return url;
    return url.substring(0, maxLength - 3) + "...";
  }
}
