export function createLargePasteFixture(
  characterCount: number,
  character = "x"
): string {
  return character.repeat(characterCount)
}
