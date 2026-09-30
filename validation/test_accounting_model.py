"""Tests of an independent oracle, NOT proof of Solidity correctness."""
from copy import deepcopy
import random
import unittest
from accounting_model import Ledger


class AccountingOracleTests(unittest.TestCase):
    def market(self, currency=0):
        l = Ledger()
        m = l.create(currency, seed=10000)
        l.bet(m, 'winner', False, 10000)
        return l, m

    def test_seed_is_owned_yes_position(self):
        l = Ledger(); m = l.create(seed=123)
        self.assertEqual(l.markets[m].positions['creator'].amount, 123)
        self.assertTrue(l.markets[m].positions['creator'].side)

    def test_standard_fee_is_two_percent_including_creator(self):
        l, m = self.market(); l.resolve(m, False)
        self.assertEqual(l.quote(m, 'winner'), (20000, 19600, 200, 200))

    def test_discount_fee_is_one_percent_in_total(self):
        l, m = self.market(); l.resolve(m, False)
        self.assertEqual(l.quote(m, 'winner', True), (20000, 19800, 200, 0))

    def test_zero_winning_pool_becomes_refundable(self):
        l = Ledger(); m = l.create(); l.resolve(m, False)
        self.assertEqual(l.refund(m, 'creator'), 100)
        self.assertEqual(l.balance, [0]*4)

    def test_resolve_does_not_transfer_funds(self):
        l, m = self.market(); before = l.balance.copy(); l.resolve(m, False)
        self.assertEqual(l.balance, before)
        self.assertEqual(l.protocol, [0]*4)

    def test_early_resolution_rejected(self):
        l, m = self.market()
        with self.assertRaises(ValueError): l.resolve(m, False, now=7199)
        self.assertEqual(l.markets[m].status, 'open')

    def test_unauthorized_resolution_rejected(self):
        l, m = self.market()
        with self.assertRaises(ValueError): l.resolve(m, False, authorized=False)

    def test_bet_at_exact_expiry_rejected(self):
        l, m = self.market()
        with self.assertRaises(ValueError): l.bet(m, 'new', True, 1, now=7200)

    def test_repeat_claim_rejected(self):
        l, m = self.market(); l.resolve(m, False); l.claim(m, 'winner')
        with self.assertRaises(ValueError): l.claim(m, 'winner')

    def test_losing_claim_rejected(self):
        l, m = self.market(); l.resolve(m, False)
        with self.assertRaises(ValueError): l.claim(m, 'creator')

    def test_failed_transfer_restores_all_state(self):
        l, m = self.market(); l.resolve(m, False); before = deepcopy(l.__dict__)
        with self.assertRaises(ValueError): l.claim(m, 'winner', transfer_succeeds=False)
        self.assertEqual(l.__dict__, before)
        self.assertEqual(l.claim(m, 'winner'), 19600)

    def test_cancellation_refunds_everyone_without_fees(self):
        l, m = self.market(); l.cancel(m)
        self.assertEqual(l.refund(m, 'creator') + l.refund(m, 'winner'), 20000)
        self.assertEqual(l.balance, [0]*4); self.assertEqual(l.protocol, [0]*4)

    def test_failed_refund_preserves_position(self):
        l, m = self.market(); l.cancel(m); before = deepcopy(l.__dict__)
        with self.assertRaises(ValueError): l.refund(m, 'winner', False)
        self.assertEqual(l.__dict__, before)

    def test_double_refund_rejected(self):
        l, m = self.market(); l.cancel(m); l.refund(m, 'winner')
        with self.assertRaises(ValueError): l.refund(m, 'winner')

    def test_resolved_market_cannot_be_cancelled(self):
        l, m = self.market(); l.resolve(m, False)
        with self.assertRaises(ValueError): l.cancel(m)

    def test_withdraw_cannot_take_principal(self):
        l, m = self.market()
        with self.assertRaises(ValueError): l.withdraw_protocol(0)
        self.assertEqual(l.balance[0], 20000)

    def test_protocol_withdrawal_leaves_creator_credits_and_other_market(self):
        l, m = self.market(); other = l.create(seed=777)
        l.balance[0] += 91  # Unsolicited donation, not a fee.
        l.resolve(m, False); l.claim(m, 'winner')
        self.assertEqual(l.withdraw_protocol(0), 200)
        self.assertEqual(l.balance[0], 777 + 200 + 91)
        self.assertEqual(l.markets[other].escrow, 777)

    def test_creator_only_collects_own_credit(self):
        l, m = self.market(); l.resolve(m, False); l.claim(m, 'winner')
        with self.assertRaises(ValueError): l.claim_creator(0, 'other')
        self.assertEqual(l.claim_creator(0, 'creator'), 200)

    def test_currency_isolation(self):
        l = Ledger(); ids = [l.create(c, seed=10000) for c in range(4)]
        for m in ids: l.bet(m, 'winner', False, 10000)
        l.resolve(ids[1], False); l.claim(ids[1], 'winner')
        self.assertEqual(l.balance, [20000, 400, 20000, 20000])
        l.check()

    def test_atomic_units_six_and_eighteen_decimals(self):
        for decimals in (6, 18):
            l = Ledger(); m = l.create(seed=100*10**decimals)
            l.bet(m, 'winner', False, 100*10**decimals); l.resolve(m, False)
            self.assertEqual(l.claim(m, 'winner'), 196*10**decimals)

    def test_transfer_roundtrip_clears_claimed_flag(self):
        l, m = self.market(); l.transfer(m, 'winner', 'new')
        l.transfer(m, 'new', 'winner'); l.bet(m, 'winner', False, 1)
        self.assertFalse(l.markets[m].positions['winner'].claimed)
        self.assertEqual(l.markets[m].positions['winner'].amount, 10001)

    def test_opposite_positions_cannot_merge(self):
        l, m = self.market()
        with self.assertRaises(ValueError): l.transfer(m, 'winner', 'creator')

    def test_self_and_unauthorized_transfers_rejected(self):
        l, m = self.market()
        with self.assertRaises(ValueError): l.transfer(m, 'winner', 'winner')
        with self.assertRaises(ValueError): l.transfer(m, 'winner', 'new', authorized=False)

    def test_invalid_amounts_rejected(self):
        l, m = self.market()
        for n in (0, -1, 1.5, True):
            with self.assertRaises(ValueError): l.bet(m, 'x', True, n)

    def test_rounding_dust_stays_reserved(self):
        l = Ledger(); m = l.create(seed=1)
        l.bet(m, 'a', True, 2); l.bet(m, 'b', False, 1); l.resolve(m, True)
        l.claim(m, 'a'); l.claim(m, 'creator')
        self.assertEqual(l.markets[m].escrow, 1)
        self.assertEqual(l.balance[0], 1)

    def test_5000_seeded_random_settlements_conserve_assets(self):
        rng = random.Random(20260930)
        for case in range(5000):
            l = Ledger(); m = l.create(case % 4, seed=rng.randrange(1, 10**20))
            for n in range(rng.randrange(1, 13)):
                l.bet(m, str(n), bool(rng.randrange(2)), rng.randrange(1, 10**20))
            original = l.balance.copy()
            outcome = bool(rng.randrange(2)); l.resolve(m, outcome)
            if l.markets[m].status == 'cancelled':
                for user in l.markets[m].positions: l.refund(m, user)
                self.assertEqual(l.balance, [0]*4)
                continue
            winners = [u for u, p in l.markets[m].positions.items() if p.side == outcome]
            rng.shuffle(winners); paid = 0
            for user in winners:
                paid += l.claim(m, user, bool(rng.randrange(2))); l.check()
            c = case % 4
            creator = l.creator_fees.get((c, 'creator'), 0)
            protocol = l.protocol[c]; dust = l.markets[m].escrow
            self.assertEqual(paid + creator + protocol + dust, original[c])
            self.assertLess(dust, len(winners))


if __name__ == '__main__': unittest.main()
