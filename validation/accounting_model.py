"""Independent integer accounting oracle. NOT Solidity/EVM execution or an audit."""
from dataclasses import dataclass, field
from copy import deepcopy


@dataclass
class Position:
    side: bool
    amount: int
    claimed: bool = False


@dataclass
class Market:
    currency: int
    creator: str
    expiry: int
    yes: int = 0
    no: int = 0
    escrow: int = 0
    status: str = 'open'
    outcome: bool | None = None
    positions: dict = field(default_factory=dict)


class Ledger:
    def __init__(self):
        self.markets = []
        self.balance = [0] * 4
        self.protocol = [0] * 4
        self.creator_fees = {}

    @staticmethod
    def positive(n):
        if type(n) is not int or n <= 0:
            raise ValueError('positive integer required')

    def create(self, currency=0, creator='creator', seed=100, expiry=7200):
        self.positive(seed)
        if currency not in range(4):
            raise ValueError('invalid currency')
        m = Market(currency, creator, expiry, seed, 0, seed)
        m.positions[creator] = Position(True, seed)
        self.markets.append(m)
        self.balance[currency] += seed
        return len(self.markets) - 1

    def bet(self, mid, user, side, amount, now=0):
        self.positive(amount)
        m = self.markets[mid]
        if m.status != 'open' or now >= m.expiry:
            raise ValueError('closed')
        p = m.positions.get(user)
        if p and p.amount and (p.claimed or p.side != side):
            raise ValueError('opposite position')
        if not p or not p.amount:
            p = m.positions[user] = Position(side, 0)
        p.amount += amount
        if side:
            m.yes += amount
        else:
            m.no += amount
        m.escrow += amount
        self.balance[m.currency] += amount

    def resolve(self, mid, outcome, now=7200, authorized=True):
        m = self.markets[mid]
        if not authorized or m.status != 'open' or now < m.expiry:
            raise ValueError('not permitted')
        if (m.yes if outcome else m.no) == 0:
            m.status = 'cancelled'
        else:
            m.status, m.outcome = 'resolved', outcome

    def cancel(self, mid, authorized=True):
        m = self.markets[mid]
        if not authorized or m.status != 'open':
            raise ValueError('not permitted')
        m.status = 'cancelled'

    def transfer(self, mid, user, recipient, now=0, authorized=True):
        m = self.markets[mid]
        if (not authorized or user == recipient or not recipient
                or m.status != 'open' or now >= m.expiry):
            raise ValueError('not permitted')
        p, target = m.positions.get(user), m.positions.get(recipient)
        if p is None or not p.amount or p.claimed:
            raise ValueError('no position')
        if target and target.amount and (target.claimed or target.side != p.side):
            raise ValueError('opposite position')
        if target is None or not target.amount:
            target = m.positions[recipient] = Position(p.side, 0)
        moved = p.amount
        target.amount += moved
        p.amount, p.claimed = 0, True
        return moved

    def quote(self, mid, user, discount=False):
        m, p = self.markets[mid], self.markets[mid].positions[user]
        if m.status != 'resolved' or not p.amount or p.claimed or p.side != m.outcome:
            raise ValueError('no winning claim')
        gross = (m.yes + m.no) * p.amount // (m.yes if m.outcome else m.no)
        fee = gross * (100 if discount else 200) // 10000
        creator = gross * 100 // 10000
        return gross, gross - fee, creator, fee - creator

    def claim(self, mid, user, discount=False, transfer_succeeds=True):
        saved = deepcopy(self.__dict__)
        try:
            gross, net, cf, pf = self.quote(mid, user, discount)
            m = self.markets[mid]
            if gross > m.escrow:
                raise ValueError('uncovered')
            m.positions[user].claimed = True
            m.escrow -= gross
            key = (m.currency, m.creator)
            self.creator_fees[key] = self.creator_fees.get(key, 0) + cf
            self.protocol[m.currency] += pf
            if not transfer_succeeds:
                raise ValueError('transfer failed')
            self.balance[m.currency] -= net
            self.check()
            return net
        except Exception:
            self.__dict__ = saved
            raise

    def refund(self, mid, user, transfer_succeeds=True):
        m, p = self.markets[mid], self.markets[mid].positions[user]
        if m.status != 'cancelled' or not p.amount or p.claimed or not transfer_succeeds:
            raise ValueError('no successful refund')
        p.claimed = True
        m.escrow -= p.amount
        self.balance[m.currency] -= p.amount
        self.check()
        return p.amount

    def withdraw_protocol(self, currency, authorized=True):
        amount = self.protocol[currency]
        if not authorized or not amount:
            raise ValueError('no authorized fee withdrawal')
        self.protocol[currency] = 0
        self.balance[currency] -= amount
        self.check()
        return amount

    def claim_creator(self, currency, creator):
        key = (currency, creator)
        amount = self.creator_fees.get(key, 0)
        if not amount:
            raise ValueError('no creator fees')
        self.creator_fees[key] = 0
        self.balance[currency] -= amount
        self.check()
        return amount

    def check(self):
        for c in range(4):
            reserved = sum(m.escrow for m in self.markets if m.currency == c)
            fees = sum(v for (currency, _), v in self.creator_fees.items() if currency == c)
            assert self.balance[c] >= reserved + fees + self.protocol[c] >= 0
        assert all(m.escrow >= 0 for m in self.markets)
