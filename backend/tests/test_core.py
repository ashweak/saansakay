from app import fares as F
from app.ai import parse_rules
from app.transit import Network

net = Network.load()


def test_jeep_fares_match_ltfrb():
    assert F.compute("jeep", 4, "regular")["fare"] == 14.0
    assert F.compute("jeep", 4, "student")["fare"] == 11.25        # LTFRB discounted minimum
    assert F.compute("jeep_modern", 3, "student")["fare"] == 13.5  # LTFRB discounted minimum
    assert F.compute("jeep", 7.2, "regular")["fare"] == 22.0       # 14 + 4 km x 2


def test_bus_fares():
    assert F.compute("bus_ordinary", 5, "regular")["fare"] == 15.0
    assert F.compute("bus", 5, "regular")["fare"] == 18.0


def test_overcharge_check():
    r = F.check("jeep", 3, "regular", 20)
    assert r["verdict"] == "overcharged" and r["difference"] == 6.0
    assert F.check("jeep", 3, "regular", 14)["verdict"] == "fair"


def test_parser_taglish():
    assert parse_rules("paano pumunta sa SM North galing Fairview")[:2] == ("fairview", "sm north")
    assert parse_rules("gusto ko pumunta sa BGC mula Quiapo, mabilis lang") == ("quiapo", "bgc", "fastest", None)
    assert parse_rules("Paano pumunta sa Megamall?")[:2] == (None, "megamall")


def test_plan_cubao_ayala_uses_mrt():
    its = net.plan(14.6195, 121.0532, 14.5492, 121.0279, "regular", 9)
    assert its
    assert any(l["mode"] == "mrt3" for l in its[0]["legs"])


def test_plan_returns_options():
    its = net.plan(14.7341, 121.0574, 14.6566, 121.0303, "student", 8)
    assert len(its) >= 1 and all(i["total_fare"] > 0 for i in its)
