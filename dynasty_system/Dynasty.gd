class_name Dynasty
extends RefCounted

enum Kind { REGULAR, SHADOW }

signal treasury_changed(new_balance: int)

const MAX_TREASURY: int = 9223372036854775807

var _id: StringName
var _name: String
var _kind: Kind
var _treasury: int


func _init(
	dynasty_id: StringName, dynasty_name: String,
	kind: Kind = Kind.REGULAR, starting_money: int = 0
) -> void:
	_id = dynasty_id
	_name = dynasty_name.strip_edges()
	_kind = kind
	_treasury = starting_money


func is_valid() -> bool:
	return (
		_id != &""
		and not String(_id).strip_edges().is_empty()
		and not _name.is_empty()
		and (_kind == Kind.REGULAR or _kind == Kind.SHADOW)
		and _treasury >= 0
	)


func get_id() -> StringName:
	return _id


func get_name() -> String:
	return _name


func get_kind() -> Kind:
	return _kind


func is_shadow() -> bool:
	return _kind == Kind.SHADOW


func get_treasury() -> int:
	return _treasury


func deposit(amount: int) -> bool:
	if amount <= 0 or amount > MAX_TREASURY - _treasury:
		return false
	_treasury += amount
	treasury_changed.emit(_treasury)
	return true


func spend(amount: int) -> bool:
	if amount <= 0 or amount > _treasury:
		return false
	_treasury -= amount
	treasury_changed.emit(_treasury)
	return true
