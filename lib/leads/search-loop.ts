export function shouldContinueGeneration(input: { stored: number; target: number; candidatesFound: number; buffer: number; tasksRemain: boolean }) {
  return input.tasksRemain && (input.stored < input.target || input.candidatesFound < input.buffer);
}
