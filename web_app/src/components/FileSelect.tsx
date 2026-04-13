import ImageDropzone from "./ImageDropzone"

type FileSelectProps = {
  onSelection: (file: File) => void
}

export default function FileSelect(props: FileSelectProps) {
  const { onSelection } = props

  return (
    <ImageDropzone fullscreen onSelection={onSelection} />
  )
}
