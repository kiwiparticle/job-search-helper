// Adds one bullet to the end of a named section of master-resume.md. Pure: text in, text out. The owner chooses which
// headings are allowed (data/master-sections.json); nothing else in the file is touched.
const HEADING = /^(#{1,6})\s+(.*?)\s*$/;

// Returns the new text, the same text when the bullet is already there, or null when the section isn't found.
export function addBullet(text, section, bullet) {
    const lines = text.split('\n');
    const start = lines.findIndex((l) => HEADING.test(l) && l.match(HEADING)[2] === section);
    if (start < 0) return null;
    const level = lines[start].match(HEADING)[1].length;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
        const m = lines[i].match(HEADING);
        if (m && m[1].length <= level) { end = i; break; }
    }
    if (lines.slice(start, end).some((l) => l.trim() === bullet)) return text;
    let last = end - 1;
    while (last > start && lines[last].trim() === '') last--;
    lines.splice(last + 1, 0, bullet);
    return lines.join('\n');
}

// The master line for an owner-supplied fact. The comment follows the master's own `<!-- src: ... -->` habit.
export const bulletFor = (text, date) => `- ${text.replace(/\s+/g, ' ').trim()} <!-- src: owner answer ${date} -->`;
