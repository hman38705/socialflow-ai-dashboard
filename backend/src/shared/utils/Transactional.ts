import { PrismaClient } from '@prisma/client';
import { TransactionOptions, TransactionClient } from './UnitOfWork';

/**
 * Symbol used to attach the PrismaClient instance to a service class.
 *
 * The decorated service must expose a `prisma` property (public or protected):
 *
 *   class MyService {
 *     constructor(private readonly prisma: PrismaClient) {}
 *
 *     @Transactional()
 *     async createUserWithOrg(userData: any, orgData: any, tx?: TransactionClient) {
 *       const org  = await (tx ?? this.prisma).organization.create({ data: orgData });
 *       const user = await (tx ?? this.prisma).user.create({ data: { ...userData, organizationId: org.id } });
 *       return { user, org };
 *     }
 *   }
 *
 * When called normally the decorator starts a new transaction and passes the
 * transaction client as the last argument.  If a `TransactionClient` is already
 * provided as the last argument the method runs inside the existing transaction
 * (transaction propagation).
 */
export function Transactional(options?: TransactionOptions) {
  return function (
    _target: object,
    _propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<(...args: any[]) => Promise<any>>,
  ): TypedPropertyDescriptor<(...args: any[]) => Promise<any>> {
    const original = descriptor.value!;

    descriptor.value = async function (this: { prisma: PrismaClient }, ...args: any[]) {
      const last = args[args.length - 1];
      const alreadyInTx = isTransactionClient(last);

      // Propagate: already inside a transaction — call through directly.
      if (alreadyInTx) {
        return original.apply(this, args);
      }

      // Start a new transaction and inject the client as the last argument.
      return this.prisma.$transaction(async (tx: TransactionClient) => {
        return original.apply(this, [...args, tx]);
      }, options);
    };

    return descriptor;
  };
}

/**
 * Heuristic: a TransactionClient has the same model delegates as PrismaClient
 * but lacks the connection/lifecycle methods stripped by Prisma's type.
 * We check for the absence of `$connect` (present on PrismaClient, absent on tx).
 */
function isTransactionClient(value: unknown): value is TransactionClient {
  return (
    value !== null &&
    typeof value === 'object' &&
    !('$connect' in value) &&
    '$queryRaw' in value
  );
}
