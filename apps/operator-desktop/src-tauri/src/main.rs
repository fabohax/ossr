fn main() {
    let arguments = std::env::args().skip(1).collect::<Vec<_>>();
    if arguments.first().map(String::as_str) == Some("--system-service-helper") {
        if let Err(error) = ossr_operator_desktop::services::privileged_helper(&arguments[1..]) {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
    ossr_operator_desktop::run();
}
