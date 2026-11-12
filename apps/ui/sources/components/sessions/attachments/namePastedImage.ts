/**
 * A name of its own for an image handed to a terminal (screenshots all arrive as "image.png"), so
 * uploads never collide and the path the agent gets has no spaces.
 */
export function namePastedImage(image: File, index: number, now: Date): File {
    const subtype = image.type.slice('image/'.length).replace(/\+.*$/, '').replace(/^jpeg$/, 'jpg') || 'png';
    const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\..*$/, '');
    return new File([image], `pasted-${stamp}-${now.getMilliseconds()}-${index + 1}.${subtype}`, { type: image.type });
}
