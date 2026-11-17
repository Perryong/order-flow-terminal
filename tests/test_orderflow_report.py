import io
import unittest
from decimal import Decimal

from research.orderflow_report import aggregate, render


class ReportTests(unittest.TestCase):
    def read(self, rows, bucket=Decimal('0.05')):
        return aggregate(io.StringIO('time_ms,price,qty,sell\n' + rows), bucket, 1)

    def test_decimal_bins_sides_and_distinct_half_hours(self):
        result = self.read('1800000,10.10,1.25,0\n59999,10.14,0.75,1\n60000,10.10,0.5,1\n60001,10.15,2,0\n')
        self.assertEqual(result['bars'], [[0, [[1, '0.75', '0', '-0.75']], '-0.75'], [60000, [[0, '0', '2', '2'], [1, '0.5', '0', '-0.5']], '1.5'], [1800000, [[1, '0', '1.25', '1.25']], '1.25']])
        self.assertEqual(result['levels'], [['10.15', '0', '2', '2', '2', [0]], ['10.1', '1.25', '1.25', '2.5', '0', [0, 1800000]]])
        self.assertEqual(result['delta'], '2')
        self.assertEqual(result['volume'], '4.5')

    def test_unknown_sides_still_contribute_to_volume_and_tpo(self):
        result = self.read('0,10.1,2,unknown\n60000,10.1,3,\n120000,10.1,1,0\n')
        self.assertEqual(result['volume'], '6')
        self.assertEqual(result['delta'], '1')
        self.assertEqual(result['unknown'], '5')
        self.assertEqual(result['levels'][0], ['10.1','0','1','6','1',[0],'5'])
        self.assertEqual(result['bars'][0][1], [[0,'0','0','0','2']])

    def test_bad_row_reports_location(self):
        for row in ['10,1,NaN,0', '10,1,0,1', '10,1,2,yes', '1,1,3,0,4', '-1,1,1,0']:
            with self.subTest(row=row), self.assertRaisesRegex(ValueError, 'line 2'):
                self.read(row + '\n')
        with self.assertRaisesRegex(ValueError, 'no ticks'):
            self.read('')

    def test_auto_bucket_and_html_escaping(self):
        result = self.read('0,68000,1,0\n', bucket=None)
        self.assertEqual(result['bucket'], '5')
        html = render(result, '<img src=x>')
        self.assertNotIn('<img src=x>', html)
        self.assertIn('&lt;img src=x&gt;', html)
        self.assertNotIn('__REPORT_DATA__', html)


if __name__ == '__main__':
    unittest.main()
