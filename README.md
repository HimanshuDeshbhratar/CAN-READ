# CAN Log Narrator

CAN Log Narrator turns a CAN bus log (candump format) and a DBC file into a plain-English timeline of what the vehicle was doing. This repository currently contains the project foundation and the DBC layer: a parser for message, signal, and value-table definitions, plus pure functions that decode raw CAN frames into physical values and encode physical values back into frame bytes.
