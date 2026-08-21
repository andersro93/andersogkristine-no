export interface GalleryProps {
  isAdmin: boolean;
  uploadOpen: boolean;
}

/** Replaced by the real island in Task 12. */
export default function Gallery({ isAdmin, uploadOpen }: GalleryProps) {
  return (
    <p className="text-body text-center">
      Galleriet kommer snart. {isAdmin ? "(admin)" : ""}{" "}
      {uploadOpen ? "" : "Opplasting er stengt."}
    </p>
  );
}
