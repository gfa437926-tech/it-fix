import { QueryConstraint, where } from 'firebase/firestore';

function chunkIds(ids: string[]): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += 30) {
    chunks.push(ids.slice(index, index + 30));
  }
  return chunks;
}

/**
 * Builds Firestore predicates that prove the same scope conditions enforced
 * by hasAssignedScope(). Records carrying both IDs must match both lists.
 * Single-dimension records are queried only when the other ID is explicitly ''.
 */
export function buildAssignedScopeConstraintGroups(
  officeIdsInput: string[],
  warehouseIdsInput: string[],
): { key: string; constraints: QueryConstraint[] }[] {
  const officeIds = [...new Set(officeIdsInput)].filter(Boolean);
  const warehouseIds = [...new Set(warehouseIdsInput)].filter(Boolean);
  const offices = chunkIds(officeIds);
  const warehouses = chunkIds(warehouseIds);
  const groups: { key: string; constraints: QueryConstraint[] }[] = [];

  for (const officeChunk of offices) {
    for (const warehouseChunk of warehouses) {
      groups.push({
        key: `both:${officeChunk.join(',')}:${warehouseChunk.join(',')}`,
        constraints: [
          where('officeId', 'in', officeChunk),
          where('warehouseId', 'in', warehouseChunk),
        ],
      });
    }
    groups.push({
      key: `office:${officeChunk.join(',')}`,
      constraints: [
        where('officeId', 'in', officeChunk),
        where('warehouseId', '==', ''),
      ],
    });
  }

  for (const warehouseChunk of warehouses) {
    groups.push({
      key: `warehouse:${warehouseChunk.join(',')}`,
      constraints: [
        where('officeId', '==', ''),
        where('warehouseId', 'in', warehouseChunk),
      ],
    });
  }

  return groups;
}
